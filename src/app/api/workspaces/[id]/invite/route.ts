'use server';

/**
 * POST /api/workspaces/[id]/invite — Create invite link (Admin/Owner only)
 *
 * WS-06: Creates a new invite link for the workspace.
 * - Only owner/admin role can create links (checked in Route Handler, not RLS)
 * - Deactivates previous active link + creates new one atomically via RPC
 * - Link expires in 24 hours, max 10 uses
 * - Returns startapp URL for Telegram Mini App
 *
 * TODO: Add rate limiting (10/IP/15min) — post-MVP
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '../../../../../../lib/supabase';
import { authenticateRequest } from '../../../../../../lib/api-auth';

/**
 * GET /api/workspaces/[id]/invite — Get current active invite link
 *
 * Returns the active invite link for the workspace if one exists.
 * Only owner/admin can view (same restriction as POST).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Extract initData from query params for GET
    const url = new URL(req.url);
    const initData = url.searchParams.get('init_data') || undefined;
    const workspaceId = (await params).id;

    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();

    // Verify membership
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('source_id', auth.profileId!)
      .eq('is_active', true)
      .maybeSingle();

    if (workerError || !workerData) {
      return NextResponse.json(
        { success: false, error: 'forbidden' },
        { status: 403 },
      );
    }

    // Get active invite link
    const { data: inviteData, error: inviteError } = await supabase
      .from('invite_links')
      .select('code, expires_at, used_count, max_uses')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .maybeSingle();

    if (inviteError) {
      console.error('invite GET: query error', inviteError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    if (!inviteData) {
      return NextResponse.json({
        success: true,
        data: { url: null },
      });
    }

    const invite = inviteData as { code: string; expires_at: string; used_count: number; max_uses: number };
    const inviteUrl = `https://t.me/onitask_bot/Onitask?startapp=${invite.code}`;

    return NextResponse.json({
      success: true,
      data: {
        url: inviteUrl,
        expires_at: invite.expires_at,
        used_count: invite.used_count,
        max_uses: invite.max_uses,
      },
    });
  } catch (err) {
    console.error('invite GET: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await req.json();
    const initData = body.init_data as string | undefined;
    const workspaceId = (await params).id;

    // 1. Authenticate via Telegram initData
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Не авторизован' },
        { status: auth.status || 401 },
      );
    }

    const supabase = createServerClient();

    // 2. Verify membership + role + get worker.id for created_by
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('source_id', auth.profileId!)
      .eq('is_active', true)
      .maybeSingle();

    if (workerError) {
      console.error('invite: worker query error', workerError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    if (!workerData) {
      return NextResponse.json(
        { success: false, error: 'forbidden' },
        { status: 403 },
      );
    }

    const worker = workerData as { id: string; role: string };

    // 3. Check role — only owner or admin
    if (worker.role !== 'owner' && worker.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'only_admin_can_invite' },
        { status: 403 },
      );
    }

    // 4. Generate random code (SEC-02: randomBytes, base64url)
    const code = randomBytes(16).toString('base64url');

    // 5. Atomic create: deactivate old + insert new via RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'create_invite_link',
      {
        p_workspace_id: workspaceId,
        p_created_by: worker.id,
        p_code: code,
      },
    );

    if (rpcError || !rpcData || rpcData.length === 0) {
      console.error('invite: RPC error', rpcError);
      return NextResponse.json(
        { success: false, error: 'invite_creation_failed' },
        { status: 500 },
      );
    }

    // 6. Build startapp URL
    // Bot username configured in BotFather with Mini App short name
    const inviteUrl = `https://t.me/onitask_bot/Onitask?startapp=${code}`;

    return NextResponse.json({
      success: true,
      data: {
        url: inviteUrl,
      },
    });
  } catch (err) {
    console.error('invite: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}