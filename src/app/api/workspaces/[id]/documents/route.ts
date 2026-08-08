pppkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkpimport { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '@/lib/telegram/validate';
import { createServerClient } from '../../../../../../lib/supabase';

// Re-export types from DocumentsCard for consistency
export type { ServerDocument, DocumentStatus } from '@/components/desk-create/DocumentsCard';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MAX_FILE_SIZE = 512 * 1024; // 512KB
const MAX_FILES_PER_REQUEST = 20;
const ALLOWED_TYPES = ['text/markdown', 'text/plain', 'application/octet-stream'];
const ALLOWED_EXTENSIONS = ['.md', '.txt'];

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

/**
 * Resolve MIME type from file extension.
 * Supabase Storage bucket 'documents' has allowed_mime_types: ['text/markdown', 'text/plain'].
 * Browser's file.type is unreliable (often '' or 'application/octet-stream').
 */
function resolveContentType(filename: string, fileType?: string): string {
  // Trust browser type only if it matches our allowed types
  if (fileType === 'text/markdown' || fileType === 'text/plain') return fileType;
  const ext = getFileExtension(filename);
  return ext === '.md' ? 'text/markdown' : 'text/plain';
}

function computeChecksum(buffer: ArrayBuffer): string {
  const hash = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < hash.length; i++) {
    binary += String.fromCharCode(hash[i]);
  }
  // Use SubtleCrypto if available, fallback to simple hash
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // This is async, but we need sync here - use simple checksum
    // In production, you'd want to make this async
  }
  // Simple checksum for now (sum of bytes)
  let sum = 0;
  for (let i = 0; i < hash.length; i++) {
    sum = (sum + hash[i]) % 1000000;
  }
  return `checksum_${sum}_${hash.length}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ success: false, error: 'server_configuration_error' }, { status: 500 });
  }

  try {
    const { id: workspaceId } = await params;
    const initData = req.headers.get('x-telegram-init-data') || '';
    if (!initData) {
      return NextResponse.json({ success: false, error: 'missing_init_data' }, { status: 400 });
    }

    const validation = await validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
    if (!validation.valid || !validation.user) {
      return NextResponse.json({ success: false, error: validation.error || 'invalid_init_data' }, { status: 401 });
    }
    const supabase = createServerClient();

    // Resolve Telegram user ID to profile ID (workers.source_id stores profile.id, not telegram_id)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(validation.user.id))
      .maybeSingle();

    if (profileError) {
      console.error('documents: profile query error', profileError);
      return NextResponse.json({ success: false, error: 'database_error' }, { status: 500 });
    }

    if (!profileData) {
      return NextResponse.json({ success: false, error: 'profile_not_found' }, { status: 404 });
    }

    // Verify user has access to this workspace
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('source_id', profileData.id)
      .maybeSingle();

    if (workerError || !workerData) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'no_files_provided' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ success: false, error: `max_${MAX_FILES_PER_REQUEST}_files_allowed` }, { status: 400 });
    }

    // Validate files
    for (const file of files) {
      const ext = getFileExtension(file.name);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return NextResponse.json(
          { success: false, error: `invalid_file_type: ${file.name}`, allowed: ALLOWED_EXTENSIONS },
          { status: 400 }
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { success: false, error: `file_too_large: ${file.name}`, max_size: MAX_FILE_SIZE },
          { status: 400 }
        );
      }
    }

    // Check doc_kb_config limits
    const { data: settings } = await supabase
      .from('workspace_settings')
      .select('doc_kb_config')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const docConfig = (settings as any)?.doc_kb_config || {};
    const maxFiles = docConfig.max_files || 20;
    const maxTotalBytes = docConfig.max_total_bytes || 5 * 1024 * 1024;

    const { count: existingCount } = await supabase
      .from('workspace_documents')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if ((existingCount || 0) + files.length > maxFiles) {
      return NextResponse.json(
        { success: false, error: 'max_files_limit_reached', max_files: maxFiles },
        { status: 400 }
      );
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const { data: existingDocs } = await supabase
      .from('workspace_documents')
      .select('size_bytes')
      .eq('workspace_id', workspaceId);

    const existingTotalSize = (existingDocs || []).reduce((sum: number, doc: any) => sum + (doc.size_bytes || 0), 0);
    if (existingTotalSize + totalSize > maxTotalBytes) {
      return NextResponse.json(
        { success: false, error: 'max_total_size_limit_reached', max_total_bytes: maxTotalBytes },
        { status: 400 }
      );
    }

    // Upload files
    const uploadedDocuments = [];
    const queueJobs = [];

    for (const file of files) {
      const fileBuffer = await file.arrayBuffer();
      const checksum = computeChecksum(fileBuffer);
      const ext = getFileExtension(file.name);
      const filename = `${crypto.randomUUID()}${ext}`;
      const storagePath = `${workspaceId}/${filename}`;

      // Upload to Supabase Storage — use extension-based content type
      // because browser file.type is unreliable (often '' or 'application/octet-stream')
      const resolvedContentType = resolveContentType(file.name, file.type);

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, new Uint8Array(fileBuffer), {
          contentType: resolvedContentType,
          upsert: false,
        });

      if (uploadError) {
        console.error('documents: upload error', uploadError);
        continue;
      }

      // Insert into workspace_documents
      const { data: docData, error: docError } = await supabase
        .from('workspace_documents')
        .insert({
          workspace_id: workspaceId,
          filename: file.name,
          file_type: ext === '.md' ? 'markdown' : 'text',
          size_bytes: file.size,
          checksum,
          chunk_count: 0,
          status: 'processing',
          uploaded_by: workerData.id,
        })
        .select()
        .single();

      if (docError) {
        console.error('documents: insert error', docError);
        // Cleanup storage
        await supabase.storage.from('documents').remove([storagePath]);
        continue;
      }

      uploadedDocuments.push(docData);

      // Add to enrichment_queue for doc_process
      const { data: queueData, error: queueError } = await supabase
        .from('enrichment_queue')
        .insert({
          workspace_id: workspaceId,
          type: 'doc_process',
          payload: {
            document_id: docData.id,
            storage_path: storagePath,
            filename: file.name,
          },
          status: 'pending',
        })
        .select()
        .single();

      if (queueError) {
        console.error('documents: queue insert error', queueError);
      } else {
        queueJobs.push(queueData);
      }
    }

    // Fire-and-forget: trigger doc-process Edge Function immediately
    // This ensures documents start processing right away without waiting for cron polling.
    // The function itself fetches pending jobs from enrichment_queue.
    // We use service_role_key because doc-process has verify_jwt: true.
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && queueJobs.length > 0) {
      void fetch(`${SUPABASE_URL}/functions/v1/doc-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'X-Client-Info': 'onitask-documents-api',
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
      }).catch((e) => {
        console.error('documents: doc-process trigger failed (non-fatal, queue still pending)', e);
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        documents: uploadedDocuments,
        queue_jobs: queueJobs.length,
      },
    });
  } catch (err) {
    console.error('documents: unexpected error', err);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

/**
 * GET /api/workspaces/[id]/documents — List workspace documents
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ success: false, error: 'server_configuration_error' }, { status: 500 });
  }

  try {
    const initData = req.headers.get('x-telegram-init-data') || '';
    if (!initData) {
      return NextResponse.json({ success: false, error: 'missing_init_data' }, { status: 400 });
    }

    const validation = await validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
    if (!validation.valid || !validation.user) {
      return NextResponse.json({ success: false, error: validation.error || 'invalid_init_data' }, { status: 401 });
    }

    const { id: workspaceId } = await params;
    const supabase = createServerClient();

    // Resolve Telegram user ID to profile ID
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(validation.user.id))
      .maybeSingle();

    if (!profileData) {
      return NextResponse.json({ success: false, error: 'profile_not_found' }, { status: 404 });
    }

    // Verify user has access to this workspace
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_id', profileData.id)
      .maybeSingle();

    if (workerError || !workerData) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    // Get documents ordered by created_at desc
    const { data: docs, error: docsError } = await supabase
      .from('workspace_documents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (docsError) {
      console.error('documents: list error', docsError);
      return NextResponse.json({ success: false, error: 'database_error' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: { documents: docs || [] },
    });
  } catch (err) {
    console.error('documents: unexpected error', err);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ success: false, error: 'server_configuration_error' }, { status: 500 });
  }

  try {
    const { id: workspaceId } = await params;
    const initData = req.headers.get('x-telegram-init-data') || '';
    if (!initData) {
      return NextResponse.json({ success: false, error: 'missing_init_data' }, { status: 400 });
    }

    const validation = await validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
    if (!validation.valid || !validation.user) {
      return NextResponse.json({ success: false, error: validation.error || 'invalid_init_data' }, { status: 401 });
    }

    const url = new URL(req.url);
    const documentId = url.pathname.split('/').pop();

    if (!documentId) {
      return NextResponse.json({ success: false, error: 'missing_document_id' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Resolve Telegram user ID to profile ID
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(validation.user.id))
      .maybeSingle();

    if (!profileData) {
      return NextResponse.json({ success: false, error: 'profile_not_found' }, { status: 404 });
    }

    // Verify user has access to this workspace
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_id', profileData.id)
      .maybeSingle();

    if (workerError || !workerData) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    // Get document info
    const { data: docData, error: docError } = await supabase
      .from('workspace_documents')
      .select('*')
      .eq('id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (docError || !docData) {
      return NextResponse.json({ success: false, error: 'document_not_found' }, { status: 404 });
    }

    // Delete from Storage
    const storagePath = `${workspaceId}/${(docData as any).filename}`;
    const { error: storageError } = await supabase.storage.from('documents').remove([storagePath]);
    if (storageError) {
      console.error('documents: storage delete error', storageError);
    }

    // Delete from workspace_documents
    const { error: deleteError } = await supabase
      .from('workspace_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      console.error('documents: delete error', deleteError);
      return NextResponse.json({ success: false, error: 'delete_failed' }, { status: 400 });
    }

    // Cancel pending enrichment jobs
    await supabase
      .from('enrichment_queue')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('type', 'doc_process')
      .eq('payload->>document_id', documentId as any)
      .eq('status', 'pending');

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('documents: unexpected error', err);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}