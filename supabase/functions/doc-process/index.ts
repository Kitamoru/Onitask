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
 * - Downloads document content from Supabase Storage (path from payload.storage_path)
 * - Chunks text into ~500 token segments
 * - Generates embeddings via NeuralDeep bge-m3
 * - Inserts chunks into workspace_doc_chunks in batches of 10 (memory-safe)
 * - Updates workspace_documents status to 'ready'
 * - Marks enrichment_queue job as 'done'
 * 
 * v8: Memory optimization — batch inserts, reduced chunk size, storage_path support.
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
    storage_path?: string;
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

const CHUNK_SIZE = 500;        // tokens per chunk (reduced from 800 — memory-safe)
const CHUNK_OVERLAP = 100;     // overlapping tokens between chunks
const MAX_CHUNKS_PER_DOC = 50; // safety limit (reduced from 200 — memory-safe)
const BATCH_SIZE = 10;         // insert chunks in batches of 10 (memory-safe)
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
 * Generate embedding via NeuralDeep Hub (bge-m3).
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
      console.error('doc_process: NEURALDEEP_KEY not configured');
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

    const { document_id, filename, file_type, storage_path } = job.payload;
    console.log(`doc_process: processing job ${job.id} doc=${document_id} file=${filename}`);

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
    // v8: Use storage_path from payload (set by route.ts on upload).
    // Fallback to legacy path for backward compatibility.
    const storagePath = storage_path || `${doc.workspace_id}/${document_id}_${filename}`;
    console.log(`doc_process: downloading storage_path=${storagePath}`);

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
        JSON.stringify({ error: 'storage_download_failed', path: storagePath }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── 5. Process content ─────────────────────────────────
    const textContent = await fileData.text();
    console.log(`doc_process: downloaded ${textContent.length} chars`);
    
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
    console.log(`doc_process: chunked into ${chunks.length} chunks`);
    
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

    // ── 7. Generate embeddings and insert chunks in batches ──
    // v8: Process in batches of BATCH_SIZE — insert and free memory.
    let insertedCount = 0;
    const errors: string[] = [];

    for (let batchStart = 0; batchStart < limitedChunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, limitedChunks.length);
      const batch: DocChunk[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const chunkTextContent = limitedChunks[i];
        
        try {
          const embedding = await generateEmbedding(chunkTextContent, neuralDeepKey);
          
          batch.push({
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

      // Insert batch
      if (batch.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertError } = await supabase
          .from('workspace_doc_chunks' as any)
          .insert(batch as any);

        if (insertError) {
          console.error('doc_process: chunk insert error', insertError);
          errors.push(`insert_batch_${batchStart}: ${JSON.stringify(insertError)}`);
        } else {
          insertedCount += batch.length;
          console.log(`doc_process: inserted batch ${batchStart}-${batchEnd} (${batch.length} chunks)`);
        }
      }

      // Free memory — batch goes out of scope
    }

    // ── 8. Update document status ──────────────────────────
    const finalStatus = errors.length > 0 && insertedCount === 0
      ? 'failed'
      : 'ready';

    await supabase
      .from('workspace_documents')
      .update({
        status: finalStatus,
        chunk_count: insertedCount,
      })
      .eq('id', document_id);

    // ── 9. Mark job as done/failed ────────────────────────
    await supabase
      .from('enrichment_queue')
      .update({
        status: finalStatus,
        processed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    // ── 10. Invalidate workspace context if needed ─────────
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
        chunk_count: insertedCount,
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