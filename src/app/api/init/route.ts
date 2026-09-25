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
 * 1. Verify Telegram initData (timingSafeEqual, A-2)
 * 2. Parse start_param into task / flow / invite namespaces.
 * 3. Find profile by telegram_id.
 * 4. For an existing user, redeem only invite links and resolve authorized task/flow targets.
 * 5. Return profile + all workspaces + optional launch_context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../lib/supabase';
import type { InitResponse } from '../../../../types/api';
import { parseStartParam } from '../../../../src/lib/taskLaunch';
import { resolveFlowLaunchTarget, resolveTaskLaunchTarget } from '../../../../src/lib/server/taskLaunch';

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
    const parsedStartParam = parseStartParam(start_param);
    const taskParam = parsedStartParam?.kind === 'task' ? parsedStartParam : null;
    const flowParam = parsedStartParam?.kind === 'flow' ? parsedStartParam : null;
    const inviteCode = parsedStartParam?.kind === 'invite' ? parsedStartParam.code : null;

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

    // 2. Find profile by telegram_id (SEC-06: convert to number for bigint column)
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

    // 3a. Profile exists — find their workers + last_active_workspace_id
    if (profileData) {
      const profile = profileData as ProfileWithActiveBoard & { last_active_workspace_id?: string | null };
      const profileId = profile.id;
      const displayName = profile.display_name;
      const lastActiveWorkspaceId = (profile as any).last_active_workspace_id ?? null;

      let invitedWorkspaceId: string | null = null;

      // Redeem an invite atomically. Task/flow deep links are not invite codes.
      if (inviteCode) {
        const { data: inviteData, error: inviteError } = await supabase.rpc(
          'accept_invite_link',
          {
            p_code: inviteCode,
            p_source_id: profileId,
            p_display_name: displayName,
          },
        );

        if (inviteError) {
          console.error('init: invite acceptance error', inviteError);
          return NextResponse.json(
            { success: false, error: 'invite_acceptance_failed' },
            { status: 500 },
          );
        }
        const accepted = Array.isArray(inviteData) ? inviteData[0] : inviteData;
        if (accepted && typeof accepted === 'object' && 'workspace_id' in accepted) {
          invitedWorkspaceId = String(accepted.workspace_id);
        }
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

      // Resolve task launch only after membership is known. This prevents a
      // cross-workspace full_id from being opened in the current board.
      const flowTarget = flowParam
        ? await resolveFlowLaunchTarget(supabase as never, profileId, flowParam.slug)
        : null;
      const launchTarget = taskParam
        ? await resolveTaskLaunchTarget(
            supabase as never,
            profileId,
            taskParam.fullId,
            taskParam.tab,
          )
        : flowTarget
          ? {
              kind: 'flow' as const,
              taskId: '',
              workspaceId: flowTarget.workspaceId,
              workspaceSlug: flowTarget.workspaceSlug,
              fullId: '',
              tab: 'general' as const,
            }
          : null;

      const launchContext = launchTarget?.kind === 'task'
        ? {
            kind: 'task' as const,
            task_id: launchTarget.taskId,
            workspace_id: launchTarget.workspaceId,
            workspace_slug: launchTarget.workspaceSlug,
            full_id: launchTarget.fullId,
            tab: launchTarget.tab,
          }
        : launchTarget?.kind === 'flow'
          ? {
              kind: 'flow' as const,
              workspace_id: launchTarget.workspaceId,
              workspace_slug: launchTarget.workspaceSlug,
            }
          : undefined;

      const effectiveWorkspaceId = launchContext?.workspace_id ?? invitedWorkspaceId ?? lastActiveWorkspaceId;

      // Return worker for the active workspace (or the deep-link/invite workspace).
      const primaryWorker =
        workers?.find((w) => w.workspace_id === effectiveWorkspaceId) ||
        workers?.find((w) => w.workspace_id === lastActiveWorkspaceId) ||
        workers?.[0] ||
        null;

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
        last_active_workspace_id: effectiveWorkspaceId,
        ...(launchContext ? { launch_context: launchContext } : {}),
        ...(taskParam && !launchContext ? { launch_error: 'task_forbidden' as const } : {}),
      };

      return NextResponse.json({ success: true, data: response });
    }

    // 3b. New user — create profile first, then redeem invite transactionally
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

    if (inviteCode) {
      const { data: inviteData, error: inviteError } = await supabase.rpc(
        'accept_invite_link',
        {
          p_code: inviteCode,
          p_source_id: userId,
          p_display_name: newDisplayName,
        },
      );

      if (inviteError) {
        console.error('init: invite acceptance error', inviteError);
        return NextResponse.json(
          { success: false, error: 'invite_acceptance_failed' },
          { status: 500 },
        );
      }

      if (inviteData && inviteData.length > 0) {
        workspaceId = (inviteData[0] as Record<string, unknown>).workspace_id as string;
        role = 'member';
        workspaces = [{
          id: workspaceId,
          name: '',
          slug: '',
          task_prefix: '',
          role: 'member',
        }];
        isNewUserFlag = false;
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
        last_active_workspace_id: workspaceId || (newProfileData as any)?.last_active_workspace_id || null,
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