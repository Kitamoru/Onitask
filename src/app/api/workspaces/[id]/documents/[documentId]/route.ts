import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '@/lib/telegram/validate';
import { createServerClient } from '../../../../../../../lib/supabase';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

/**
 * DELETE /api/workspaces/[id]/documents/[documentId] - Delete a single document
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ success: false, error: 'server_configuration_error' }, { status: 500 });
  }

  try {
    const { id: workspaceId, documentId } = await params;
    const initData = req.headers.get('x-telegram-init-data') || '';
    if (!initData) {
      return NextResponse.json({ success: false, error: 'missing_init_data' }, { status: 400 });
    }

    const validation = await validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
    if (!validation.valid || !validation.user) {
      return NextResponse.json({ success: false, error: validation.error || 'invalid_init_data' }, { status: 401 });
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

    // Get document data
    const { data: docData, error: docError } = await supabase
      .from('workspace_documents')
      .select('*')
      .eq('id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (docError || !docData) {
      return NextResponse.json({ success: false, error: 'document_not_found' }, { status: 404 });
    }

    // Delete from Supabase Storage using multiple possible paths (fallback strategy)
    // The file might be stored under different paths depending on when it was uploaded:
    // - New uploads: {workspace_id}/{uuid}.{ext} via storage_path
    // - Old uploads: {workspace_id}/{filename} or {workspace_id}/{original_uuid}.{ext}
    const docAny = docData as any;
    const ext = getFileExtension(docAny.filename);
    const storagePathsToDelete: string[] = [];

    // Priority 1: Exact storage_path from DB (set by migration 022 for old records, auto-set for new)
    if (docAny.storage_path) {
      storagePathsToDelete.push(docAny.storage_path);
    }

    // Priority 2: {workspace_id}/{filename} — original filename
    storagePathsToDelete.push(`${workspaceId}/${docAny.filename}`);

    // Try each path, ignore errors (file may not exist or may have been deleted already)
    let storageDeleted = false;
    for (const path of storagePathsToDelete) {
      const { error: storageError } = await supabase.storage.from('documents').remove([path]);
      if (!storageError) {
        storageDeleted = true;
        console.log(`documents: deleted from storage at path: ${path}`);
        break;
      }
      // 404 = file not found at this path, try next
      if (storageError?.message?.includes('404') || storageError?.message?.includes('not found')) {
        console.log(`documents: storage path not found, trying next: ${path}`);
        continue;
      }
      console.warn(`documents: storage delete error for path ${path}:`, storageError);
    }

    if (!storageDeleted) {
      console.warn(`documents: could not delete file from storage for document ${documentId}, but will delete DB record`);
    }

    // Delete database record
    const { error: deleteError } = await supabase
      .from('workspace_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      console.error('documents: delete error', deleteError);
      return NextResponse.json({ success: false, error: 'delete_failed' }, { status: 500 });
    }

    // Clean up pending enrichment queue entries
    await supabase
      .from('enrichment_queue')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('type', 'doc_process')
      .eq('payload->>document_id', documentId)
      .eq('status', 'pending');

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('documents: unexpected error', err);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}