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
import { validateTelegramInitData } from '../../../../lib/telegramAuth';
import { createServerClient } from '../../../../lib/supabase';
import type { InitResponse } from '../../../../types/api';

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  task_prefix: string;
  role: string | null;
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
    const { init_data, start_param } = body as { init_data?: string; start_param?: string };

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    // 1. Verify Telegram initData (timingSafeEqual, A-2)
    const validation = await validateTelegramInitData(init_data, TELEGRAM_BOT_TOKEN);

    if (!validation.valid || !validation.user) {
      return NextResponse.json(
        { success: false, error: validation.error || 'invalid_init_data' },
        { status: 401 },
      );
    }

    const telegramUser = validation.user;
    const supabase = createServerClient();

    // 2. Find profile by telegram_id (SEC-06: convert to number for bigint column)
    const { data: existingProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*, workers!inner(workspace_id, role)')
      .eq('telegram_id', Number(telegramUser.id))
      .maybeSingle();

    if (profileError) {
      console.error('init: profile query error', profileError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    // 3a. Profile exists тАФ return as-is (INV-16: do NOT update display_name/avatar_url)
    if (existingProfile) {
      const profile = existingProfile as Record<string, unknown>;
      const profileId = profile.id as string;
      const displayName = profile.display_name as string;

      // Get all workspaces for this user
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
    const { data: newProfileData, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        telegram_id: Number(telegramUser.id),
        display_name: newDisplayName,
        avatar_url: null,
      })
      .select()
      .single();

    if (insertError || !newProfileData) {
      console.error('init: profile creation error', insertError);
      return NextResponse.json(
        { success: false, error: 'profile_creation_failed' },
        { status: 500 },
      );
    }

    const newProfile = newProfileData as Record<string, unknown>;

    // Build response
    let workspaces: WorkspaceInfo[] = [];
    let workspaceId = '';
    let role: string | null = null;
    let isNewUser = true;

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
          isNewUser = false;
        }
      } else {
        // Worker already exists (edge case)
        isNewUser = false;
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
      is_new_user: isNewUser,
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
