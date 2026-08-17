'use server';

/**
 * POST /api/init — Find-or-create user profile and workspace membership
 *
 * INV-16: find-or-create ONLY. display_name and avatar_url are set
 * at creation from Telegram initData and updated ONLY through explicit
 * profile settings in TWA. Auto-update on repeated /api-init calls is forbidden.
 *
 * WS-06: Process start_param from Telegram Mini App deep link for invite links.
 * If user followed a referral link — creates worker in target workspace.
 * Works for BOTH new and existing users (Scenario 3: existing user joins new workspace).
 *
 * Algorithm:
 * 1. Verify Telegram initData (timingSafeEqual, A-2)
 * 2. If start_param present — call atomic RPC accept_invite_link
 *    - RPC increments used_count + returns workspace_id (or 0 rows if invalid)
 * 3. Find profile by telegram_id
 * 4. If profile found:
 *    a. If invitedWorkspaceId — find-or-create worker in that workspace
 *    b. Return profile + all workspaces + is_new_user=false
 * 5. If profile not found:
 *    a. Create profile from Telegram data
 *    b. If invitedWorkspaceId — create worker with role='member'
 *    c. Return profile + workspaces + is_new_user flag
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../lib/supabase';
import type { InitResponse } from '../../../../types/api';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  task_prefix: string;
  role: string | null;
}

interface ProfileWithActiveBoard {
  id: string;
  telegram_id: number;
  display_name: string;
  avatar_url: string | null;
  last_active_workspace_id: string | null;
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export async function POST(req: NextRequest) {
  // Guard: require TELEGRAM_BOT_TOKEN to be set
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('init: TELEGRAM_BOT_TOKEN is not set in environment variables');
    return NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    // Accept both camelCase (initData) and snake_case (init_data) for backward compatibility
    const initData = (body.initData || body.init_data) as string | undefined;
    const start_param = body.start_param as string | undefined;

    // Server-side logging for deep link debugging (Vercel Logs)
    console.info('[INIT] request received', {
      has_init_data: !!initData,
      start_param,
      content_type: req.headers.get('content-type'),
    });

    if (!initData) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    // 1. Verify Telegram initData (timingSafeEqual, A-2)
    const validation = await validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);

    if (!validation.valid || !validation.user) {
      return NextResponse.json(
        { success: false, error: validation.error || 'invalid_init_data' },
        { status: 401 },
      );
    }

    const telegramUser = validation.user;
    const supabase = createServerClient();

    // 2. If start_param present — call atomic RPC accept_invite_link
    // This is done BEFORE profile check so existing users can join new workspaces (Scenario 3)
    let invitedWorkspaceId: string | null = null;

    if (start_param) {
      const { data: inviteData, error: inviteError } = await supabase.rpc(
        'accept_invite_link',
        { p_code: start_param },
      );

      if (!inviteError && inviteData && inviteData.length > 0) {
        invitedWorkspaceId = (inviteData[0] as Record<string, unknown>).workspace_id as string;
      }
      // If RPC returns 0 rows — link is invalid/expired/exhausted, fallback to standard logic
    }

    // 3. Find profile by telegram_id (SEC-06: convert to number for bigint column)
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, telegram_id, display_name, avatar_url, last_active_workspace_id')
      .eq('telegram_id', Number(telegramUser.id))
      .maybeSingle() as { data: (ProfileWithActiveBoard & { last_active_workspace_id?: string | null }) | null; error: unknown };

    if (profileError) {
      console.error('init: profile query error', profileError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    // 4a. Profile exists — find their workers + last_active_workspace_id
    if (profileData) {
      const profile = profileData as ProfileWithActiveBoard & { last_active_workspace_id?: string | null };
      const profileId = profile.id;
      const displayName = profile.display_name;
      const lastActiveWorkspaceId = (profile as any).last_active_workspace_id ?? null;

      // If invited to a new workspace — find-or-create worker (Scenario 3)
      // Idempotent: if worker already exists (UNIQUE workspace_id+source_id), do nothing
      if (invitedWorkspaceId) {
        await supabase
          .from('workers')
          .upsert({
            workspace_id: invitedWorkspaceId,
            source_id: profileId,
            type: 'human',
            role: 'member',
            display_name: displayName,
          }, { onConflict: 'workspace_id,source_id', ignoreDuplicates: true });
      }

      // Get all active workers for this profile (source_id matches profile id as text)
      const { data: workersData, error: workersError } = await supabase
        .from('workers')
        .select('id, workspace_id, role')
        .eq('source_id', profileId)
        .eq('is_active', true);

      if (workersError) {
        console.error('init: workers query error', workersError);
        return NextResponse.json(
          { success: false, error: 'database_error' },
          { status: 500 },
        );
      }

      const workers = workersData as Array<{ id: string; workspace_id: string; role: string | null }> | null;
      const workspaceIds = workers?.map((w) => w.workspace_id) || [];

      let workspaces: WorkspaceInfo[] = [];

      if (workspaceIds.length > 0) {
        const { data: wsData } = await supabase
          .from('workspaces')
          .select('id, name, slug, task_prefix')
          .in('id', workspaceIds);

        const wsList = wsData as Array<{ id: string; name: string; slug: string; task_prefix: string }> | null;
        workspaces = (wsList || []).map((ws) => ({
          ...ws,
          role: workers?.find((w) => w.workspace_id === ws.id)?.role || null,
        }));
      }

      // Return primary workspace worker info — use actual worker.id, not profileId
      const primaryWorker = workers?.[0] || null;

      const response: InitResponse = {
        worker: {
          id: primaryWorker?.id || profileId,
          display_name: displayName,
          workspace_id: primaryWorker?.workspace_id || '',
          role: primaryWorker?.role || null,
        },
        profile_id: profileId,
        workspaces,
        is_new_user: false,
        last_active_workspace_id: lastActiveWorkspaceId,
      };

      return NextResponse.json({ success: true, data: response });
    }

    // 4b. New user — create profile + optionally worker from invite
    const userId = crypto.randomUUID();

    // Generate display_name from Telegram data
    const newDisplayName =
      telegramUser.username ||
      [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') ||
      `User_${telegramUser.id}`;

    // Create profile (SEC-06: convert string id to number for bigint column)
    const { data: newProfileDataRaw, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        telegram_id: Number(telegramUser.id),
        display_name: newDisplayName,
        avatar_url: null,
      })
      .select()
      .single();

    if (insertError || !newProfileDataRaw) {
      console.error('init: profile creation error', insertError);
      return NextResponse.json(
        { success: false, error: 'profile_creation_failed' },
        { status: 500 },
      );
    }

    const newProfileData = newProfileDataRaw as Record<string, unknown>;

    // Build response
    let workspaces: WorkspaceInfo[] = [];
    let workspaceId = '';
    let role: string | null = null;
    let isNewUserFlag = true;

    // If there's a valid invite link, try to create worker
    if (invitedWorkspaceId) {
      const { data: existingWorker } = await supabase
        .from('workers')
        .select('workspace_id, role')
        .eq('source_id', userId)
        .eq('workspace_id', invitedWorkspaceId)
        .eq('is_active', true)
        .maybeSingle();

      if (!existingWorker) {
        const { data: newWorker, error: workerError } = await supabase
          .from('workers')
          .insert({
            workspace_id: invitedWorkspaceId,
            source_id: userId,
            type: 'human',
            role: 'member',
            display_name: newDisplayName,
          })
          .select('workspace_id, role')
          .single();

        if (!workerError && newWorker) {
          workspaceId = invitedWorkspaceId;
          role = 'member';
          workspaces = [{
            id: invitedWorkspaceId,
            name: '',
            slug: '',
            task_prefix: '',
            role: 'member',
          }];
          isNewUserFlag = false;
        }
      } else {
        // Worker already exists (edge case)
        isNewUserFlag = false;
        workspaceId = (existingWorker as Record<string, unknown>).workspace_id as string;
        role = (existingWorker as Record<string, unknown>).role as string;
        workspaces = [{
          id: workspaceId,
          name: '',
          slug: '',
          task_prefix: '',
          role,
        }];
      }
    }

    const response: InitResponse = {
      worker: {
        id: userId,
        display_name: newDisplayName,
        workspace_id: workspaceId,
        role,
      },
      profile_id: userId,
      workspaces,
      is_new_user: isNewUserFlag,
      last_active_workspace_id: (newProfileData as any)?.last_active_workspace_id ?? null,
    };

    return NextResponse.json({ success: true, data: response });
  } catch (err) {
    console.error('init: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}