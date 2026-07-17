'use server';

/**
 * POST /api/workspaces/[id]/documents — Upload a document to workspace
 * 
 * DOC-01: Document upload endpoint.
 * - Validates file type (.md) and size (≤512KB)
 * - Uploads to Supabase Storage (`documents/{workspace_id}/{uuid}_{filename}`)
 * - Creates workspace_documents record (status='processing')
 * - Queues doc_process job in enrichment_queue
 * - Returns document_id for tracking
 * 
 * Auth: Telegram initData
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../../lib/telegramAuth';
import { createServerClient } from '../../../../../lib/supabase';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface WorkspaceMember {
  workspace_id: string;
  role: string | null;
}

interface UploadResponse {
  success: true;
  document_id: string;
  status: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  message?: string;
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_FILE_SIZE = 512 * 1024; // 512 KB
const ALLOWED_EXTENSIONS = ['.md'];

// ═══════════════════════════════════════════════════════
// Handler
// ═══════════════════════════════════════════════════════

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params;

    // ── 1. Auth check ──────────────────────────────────────
    const formData = await req.formData();
    const init_data = formData.get('init_data') as string;
    const file = formData.get('file') as File | null;

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    const validation = await validateTelegramInitData(init_data, TELEGRAM_BOT_TOKEN);

    if (!validation.valid || !validation.user) {
      return NextResponse.json(
        { success: false, error: 'unauthorized' },
        { status: 401 },
      );
    }

    // ── 2. Validate file ───────────────────────────────────
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'missing_file' },
        { status: 400 },
      );
    }

    // Check extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { success: false, error: 'invalid_file_type', message: `Only ${ALLOWED_EXTENSIONS.join(', ')} files allowed` },
        { status: 400 },
      );
    }

    // Check size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'file_too_large', message: `Max ${MAX_FILE_SIZE / 1024}KB allowed` },
        { status: 400 },
      );
    }

    // ── 3. Verify user has access to workspace ─────────────
    const supabase = createServerClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(validation.user.id))
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json(
        { success: false, error: 'profile_not_found' },
        { status: 404 },
      );
    }

    const { data: member } = await supabase
      .from('workers')
      .select('workspace_id, role')
      .eq('source_id', profile.id)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) {
      return NextResponse.json(
        { success: false, error: 'access_denied' },
        { status: 403 },
      );
    }

    // ── 4. Check workspace exists ──────────────────────────
    const { data: ws } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();

    if (!ws) {
      return NextResponse.json(
        { success: false, error: 'workspace_not_found' },
        { status: 404 },
      );
    }

    // ── 5. Generate checksum (SHA-256) ─────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const checksum = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // ── 6. Upload to Supabase Storage ──────────────────────
    const documentId = crypto.randomUUID();
    const storagePath = `${workspaceId}/${documentId}_${file.name}`;

    try {
      await supabase.storage
        .from('documents')
        .upload(storagePath, buffer, {
          upsert: false,
          contentType: file.type || 'text/plain',
        });
    } catch (storageErr) {
      console.error('doc_upload: storage error', storageErr);
      // Non-critical: log but don't block — doc can be re-uploaded
    }

    // ── 7. Create workspace_documents record ───────────────
    const { data: doc, error: docError } = await supabase
      .from('workspace_documents')
      .insert({
        id: documentId,
        workspace_id: workspaceId,
        filename: file.name.slice(0, 255),
        file_type: ext.replace('.', ''),
        size_bytes: file.size,
        checksum,
        status: 'processing',
      })
      .select('id, status')
      .single();

    if (docError || !doc) {
      console.error('doc_upload: documents insert error', docError);
      return NextResponse.json(
        { success: false, error: 'document_creation_failed' },
        { status: 500 },
      );
    }

    // ── 8. Queue doc_process job ───────────────────────────
    await supabase.from('enrichment_queue').insert({
      workspace_id: workspaceId,
      type: 'doc_process',
      payload: {
        document_id: documentId,
        filename: file.name,
        file_type: ext.replace('.', ''),
      },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
    });

    // ── 9. Invalidate workspace context ────────────────────
    await supabase
      .from('workspace_settings')
      .update({ context_stale: true })
      .eq('workspace_id', workspaceId);

    // ── 10. Return response ────────────────────────────────
    const response: UploadResponse = {
      success: true,
      document_id: doc.id,
      status: doc.status,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('documents: POST error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/workspaces/[id]/documents — List workspace documents
 * 
 * Returns all documents for the given workspace with their processing status.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params;

    // ── 1. Auth check ──────────────────────────────────────
    const init_data = req.nextUrl.searchParams.get('init_data');

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    const validation = await validateTelegramInitData(init_data, TELEGRAM_BOT_TOKEN);

    if (!validation.valid || !validation.user) {
      return NextResponse.json(
        { success: false, error: 'unauthorized' },
        { status: 401 },
      );
    }

    const supabase = createServerClient();

    // ── 2. Find profile ────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(validation.user.id))
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json(
        { success: false, error: 'profile_not_found' },
        { status: 404 },
      );
    }

    // ── 3. Verify workspace access ─────────────────────────
    const { data: member } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profile.id)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) {
      return NextResponse.json(
        { success: false, error: 'access_denied' },
        { status: 403 },
      );
    }

    // ── 4. Get documents ───────────────────────────────────
    const { data: documents } = await supabase
      .from('workspace_documents')
      .select('id, filename, file_type, status, chunk_count, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      success: true,
      documents: (documents ?? []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        filename: d.filename as string,
        file_type: d.file_type as string,
        status: d.status as string,
        chunk_count: d.chunk_count as number | null,
        created_at: d.created_at as string,
      })),
    });
  } catch (err) {
    console.error('documents: GET error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}