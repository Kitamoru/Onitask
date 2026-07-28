'use server';

/**
 * POST /api/init тАФ Find-or-create user profile and workspace membership
 * 
 * INV-16: find-or-create ╨в╨Ю╨Ы╨м╨Ъ╨Ю. display_name ╨╕ avatar_url ╤Г╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╤О╤В╤Б╤П
 * ╨┐╤А╨╕ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╨╕ ╨╕╨╖ Telegram initData ╨╕ ╨╛╨▒╨╜╨╛╨▓╨╗╤П╤О╤В╤Б╤П ╨в╨Ю╨Ы╨м╨Ъ╨Ю ╤З╨╡╤А╨╡╨╖ ╤П╨▓╨╜╤Л╨╡ ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨╕
 * ╨┐╤А╨╛╤Д╨╕╨╗╤П ╨▓ TWA. ╨Р╨▓╤В╨╛╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╕╨╡ ╨┐╤А╨╕ ╨┐╨╛╨▓╤В╨╛╤А╨╜╤Л╤Е ╨▓╤Л╨╖╨╛╨▓╨░╤Е /api-init ╨╖╨░╨┐╤А╨╡╤Й╨╡╨╜╨╛.
 * 
 * WS-06: ╨Ю╨▒╤А╨░╨▒╨╛╤В╨║╨░ start_param ╨╕╨╖ Telegram Mini App deep link ╨┤╨╗╤П ╨╕╨╜╨▓╨░╨╣╤В-╤Б╤Б╤Л╨╗╨╛╨║.
 * ╨Х╤Б╨╗╨╕ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М ╨┐╨╡╤А╨╡╤И╤С╨╗ ╨┐╨╛ ╤А╨╡╤Д╨╡╤А╨░╨╗╤М╨╜╨╛╨╣ ╤Б╤Б╤Л╨╗╨║╨╡ тАФ ╤Б╨╛╨╖╨┤╨░╤С╤В╤Б╤П worker ╨▓ ╤Ж╨╡╨╗╨╡╨▓╨╛╨╝ workspace.
 * 
 * Algorithm:
 * 1. ╨Т╨╡╤А╨╕╤Д╨╕╤Ж╨╕╤А╨╛╨▓╨░╤В╤М Telegram initData (timingSafeEqual, A-2)
 * 2. ╨Э╨░╨╣╤В╨╕ profiles WHERE telegram_id = user.id
 * 3. ╨Х╤Б╨╗╨╕ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜ тЖТ ╤Б╨╛╨╖╨┤╨░╤В╤М profile (+ worker ╨╡╤Б╨╗╨╕ ╨╡╤Б╤В╤М invite link)
 * 4. ╨Х╤Б╨╗╨╕ ╨╜╨░╨╣╨┤╨╡╨╜ тЖТ ╨▓╨╡╤А╨╜╤Г╤В╤М ╨║╨░╨║ ╨╡╤Б╤В╤М (╨Э╨Х ╨╛╨▒╨╜╨╛╨▓╨╗╤П╤В╤М display_name/avatar_url)
 * 5. ╨Т╨╡╤А╨╜╤Г╤В╤М ╨┐╤А╨╛╤Д╨╕╨╗╤М + ╤Б╨┐╨╕╤Б╨╛╨║ workspace + is_new_user
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
    // Note: workers.source_id is text, profiles.id is uuid — no FK relationship exists.
    // We query profiles first, then fetch workers separately.
    // last_active_workspace_id added in migration 016 (applied before deploy).
    // Use as any to bypass type check until migration is applied locally.
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

      // Get all active workers for this profile (source_id matches profile id as text)
      const { data: workersData, error: workersError } = await supabase
        .from('workers')
        .select('workspace_id, role')
        .eq('source_id', profileId)
        .eq('is_active', true);

      if (workersError) {
        console.error('init: workers query error', workersError);
        return NextResponse.json(
          { success: false, error: 'database_error' },
          { status: 500 },
        );
      }

      const workers = workersData as Array<{ workspace_id: string; role: string | null }> | null;
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

      // Return primary workspace worker info
      const primaryWorker = workers?.[0] || null;

      const response: InitResponse = {
        worker: {
          id: profileId,
          display_name: displayName,
          workspace_id: primaryWorker?.workspace_id || '',
          role: primaryWorker?.role || null,
        },
        workspaces,
        is_new_user: false,
        last_active_workspace_id: lastActiveWorkspaceId,
      };

      return NextResponse.json({ success: true, data: response });
    }

    // 3b. Check for valid invite link via start_param (WS-06)
    let invitedWorkspaceId: string | null = null;

    if (start_param) {
      const inviteResult = await supabase
        .from('invite_links')
        .select('workspace_id')
        .eq('code', start_param)
        .eq('is_active', true)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (inviteResult.data && !inviteResult.error) {
        invitedWorkspaceId = (inviteResult.data as Record<string, unknown>).workspace_id as string;
      }
    }

    // 3c. New user тАФ create profile + optionally worker from invite
    const userId = crypto.randomUUID();

    // Generate display_name from Telegram data
    const newDisplayName =
      telegramUser.username ||
      [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') ||
      `User_${telegramUser.id}`;

    // Create profile (SEC-06: convert string id to number for bigint column)
    // Note: last_active_workspace_id defaults to NULL for new users
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
