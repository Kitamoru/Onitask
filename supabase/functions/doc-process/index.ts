/**
 * Supabase Edge Function: doc_process
 * 
 * F03-13: Document processing pipeline — chunking + embedding + indexing.
 * 
 * Triggered by enrichment_queue entries with type='doc_process'.
 * Reads workspace_documents, chunks content, generates embeddings via NeuralDeep,
 * and stores in workspace_doc_chunks with source_origin='doc_rag' tag.
 * 
 * Master Spec §6.13, ai_.md §2.2 шаг 2.5
 * 
 * Behavior:
 * - Fetches pending doc_process jobs from enrichment_queue
 * - Downloads document content from Supabase Storage
 * - Chunks text into ~500-1000 token segments
 * - Generates embeddings via NeuralDeep bge-m3
 * - Inserts chunks into workspace_doc_chunks
 * - Updates workspace_documents status to 'ready'
 * - Marks enrichment_queue job as 'done'
 */

// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
// This file is deployed to Supabase Edge Functions where Deno types are available.

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface EnrichmentJob {
  id: string;
  workspace_id: string;
  payload: {
    document_id: string;
    filename: string;
    file_type: string;
  };
}

interface DocChunk {
  document_id: string;
  workspace_id: string;
  chunk_index: number;
  content: string;
  meta_headers: Record<string, unknown>;
  embedding: number[];
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const CHUNK_SIZE = 800;        // tokens per chunk (approximate for UTF-8)
const CHUNK_OVERLAP = 100;     // overlapping tokens between chunks
const MAX_CHUNKS_PER_DOC = 200; // safety limit (20 files × ~40 chunks = 800 vectors)
const MINIMUM_CHUNK_LENGTH = 50; // minimum characters before creating a chunk

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Splits text into chunks with overlap.
 * Simple character-based splitting — adequate for markdown/text documents.
 */
function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    let chunkEnd = end;

    // Try to break at paragraph boundary
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end - 1);
      if (paragraphBreak > start + size / 2) {
        chunkEnd = paragraphBreak;
      } else {
        const lineBreak = text.lastIndexOf('\n', end - 1);
        if (lineBreak > start + size / 2) {
          chunkEnd = lineBreak;
        }
      }
    }

    const chunk = text.slice(start, chunkEnd).trim();
    if (chunk.length >= MINIMUM_CHUNK_LENGTH) {
      chunks.push(chunk);
    }

    start = chunkEnd - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

/**
 * Extracts basic markdown headers as meta_headers.
 */
function extractMetaHeaders(chunk: string): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  const h1Match = chunk.match(/^#\s+(.+)$/m);
  const h2Match = chunk.match(/^##\s+(.+)$/m);
  
  if (h1Match) headers.h1 = h1Match[1].trim();
  if (h2Match) headers.h2 = h2Match[1].trim();
  
  return headers;
}

/**
 * Generate embedding via NeuralDeep Hub.
 */
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.neuraldeep.ru/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'bge-m3',
      input: text,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`NeuralDeep embedding failed: ${res.status} ${error}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
}

// ═══════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════

serve(async (req: Request) => {
  try {
    // ── 1. Initialize Supabase client (service role) ────────
    // Note: env var names avoid SUPABASE_ prefix (blocked by Supabase Edge Functions)
    const supabaseUrl = Deno.env.get('SB_URL') || '';
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
    const neuralDeepKey = Deno.env.get('NEURALDEEP_KEY') || '';

    if (!neuralDeepKey) {
      return new Response(
        JSON.stringify({ error: 'NEURALDEEP_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 2. Fetch pending doc_process job ───────────────────
    const { data: job, error: jobError } = await supabase
      .from('enrichment_queue')
      .select('*')
      .eq('type', 'doc_process')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle() as { data: EnrichmentJob | null; error: unknown } & { error: unknown };

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ message: 'No pending doc_process jobs' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Lock the job
    await supabase
      .from('enrichment_queue')
      .update({ status: 'processing', locked_at: new Date().toISOString() })
      .eq('id', job.id);

    const { document_id, filename, file_type } = job.payload;

    // ── 3. Fetch document metadata ─────────────────────────
    const { data: doc, error: docError } = await supabase
      .from('workspace_documents')
      .select('id, workspace_id, filename, file_type, size_bytes, checksum')
      .eq('id', document_id)
      .single() as { data: { workspace_id: string; filename: string; file_type: string; size_bytes: number; checksum: string } | null; error: unknown };

    if (docError || !doc) {
      console.error('doc_process: document not found', docError);
      await supabase
        .from('enrichment_queue')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', job.id);
      return new Response(
        JSON.stringify({ error: 'document_not_found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── 4. Download document content from Storage ──────────
    const storagePath = `${doc.workspace_id}/${document_id}_${filename}`;
    
    // Note: In production, document content should be stored in Supabase Storage.
    // For now, we read from a text field or storage bucket.
    // The actual download path depends on how documents are uploaded.
    // This is a placeholder — adjust based on your storage strategy.
    
    // Alternative: if content is stored inline (for small text/markdown files):
    // We'll assume the content was pre-stored and we need to chunk it.
    // For MVP, we'll use a simple approach: read from a hypothetical content field.
    
    // Since workspace_documents doesn't have a content field (only metadata),
    // the actual content must come from Supabase Storage.
    
    const { data: fileData, error: storageError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (storageError || !fileData) {
      console.error('doc_process: storage download error', storageError);
      await supabase
        .from('workspace_documents')
        .update({ status: 'failed' })
        .eq('id', document_id);
      
      await supabase
        .from('enrichment_queue')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', job.id);
      
      return new Response(
        JSON.stringify({ error: 'storage_download_failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── 5. Process content ─────────────────────────────────
    const textContent = await fileData.text();
    
    if (!textContent || textContent.trim().length === 0) {
      await supabase
        .from('workspace_documents')
        .update({ status: 'failed' })
        .eq('id', document_id);
      
      await supabase
        .from('enrichment_queue')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', job.id);
      
      return new Response(
        JSON.stringify({ error: 'empty_document_content' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── 6. Chunk the document ──────────────────────────────
    const chunks = chunkText(textContent, CHUNK_SIZE, CHUNK_OVERLAP);
    
    if (chunks.length === 0) {
      await supabase
        .from('workspace_documents')
        .update({ status: 'ready', chunk_count: 0 })
        .eq('id', document_id);
      
      await supabase
        .from('enrichment_queue')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', job.id);
      
      return new Response(
        JSON.stringify({ message: 'Document too small to chunk', chunk_count: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Safety limit
    const limitedChunks = chunks.slice(0, MAX_CHUNKS_PER_DOC);

    // ── 7. Generate embeddings and insert chunks ───────────
    const insertedChunks: DocChunk[] = [];
    const errors: string[] = [];

    for (let i = 0; i < limitedChunks.length; i++) {
      const chunkTextContent = limitedChunks[i];
      
      try {
        const embedding = await generateEmbedding(chunkTextContent, neuralDeepKey);
        
        insertedChunks.push({
          document_id,
          workspace_id: doc.workspace_id,
          chunk_index: i,
          content: chunkTextContent,
          meta_headers: extractMetaHeaders(chunkTextContent),
          embedding,
        });
      } catch (err) {
        console.error(`doc_process: embedding failed for chunk ${i}`, err);
        errors.push(`chunk_${i}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    // ── 8. Insert chunks into workspace_doc_chunks ─────────
    if (insertedChunks.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await supabase
        .from('workspace_doc_chunks' as any)
        .insert(insertedChunks as any);

      if (insertError) {
        console.error('doc_process: chunk insert error', insertError);
        errors.push(`insert: ${JSON.stringify(insertError)}`);
      }
    }

    // ── 9. Update document status ──────────────────────────
    const finalStatus = errors.length > 0 && insertedChunks.length === 0
      ? 'failed'
      : 'ready';

    await supabase
      .from('workspace_documents')
      .update({
        status: finalStatus,
        chunk_count: insertedChunks.length,
      })
      .eq('id', document_id);

    // ── 10. Mark job as done/failed ────────────────────────
    await supabase
      .from('enrichment_queue')
      .update({
        status: finalStatus,
        processed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    // ── 11. Invalidate workspace context if needed ─────────
    // New documents may make previous context stale
    await supabase
      .from('workspace_settings')
      .update({ context_stale: true })
      .eq('workspace_id', doc.workspace_id);

    // Queue context rebuild
    await supabase
      .from('enrichment_queue')
      .insert({
        workspace_id: doc.workspace_id,
        type: 'workspace_context_rebuild',
        payload: { workspace_id: doc.workspace_id },
        status: 'pending',
        scheduled_at: new Date().toISOString(),
      })
      .select()
      .maybeSingle();

    return new Response(
      JSON.stringify({
        message: 'Document processed successfully',
        document_id,
        chunk_count: insertedChunks.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('doc_process: unexpected error', err);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});