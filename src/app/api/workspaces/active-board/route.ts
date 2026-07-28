'use server';

/**
 * POST /api/workspaces/active-board — Save last_active_board_id to workspace_settings
 * 
 * Algorithm:
 * 1. Verify Telegram initData
 * 2. Find workspace_settings for user's workspace
 * 3. Update last_active_board_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../../lib/supabase';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export async function POST(req: NextRequest) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('active-board: TELEGRAM_BOT_TOKEN is not set');
    return NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const init_data = body.init_data as string | undefined;
    const workspace_id = body.workspace_id as string | undefined;
    const board_id = body.board_id as string | undefined;

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    if (!workspace_id || !board_id) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id_or_board_id' },
        { status: 400 },
      );
    }

    // 1. Verify Telegram initData
    const validation = await validateTelegramInitData(init_data, TELEGRAM_BOT_TOKEN);
    if (!validation.valid || !validation.user) {
      return NextResponse.json(
        { success: false, error: validation.error || 'invalid_init_data' },
        { status: 401 },
      );
    }

    const telegramUser = validation.user;
    const supabase = createServerClient();

    // 2. Find profile by telegram_id
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_id', Number(telegramUser.id))
      .maybeSingle();

    if (!profileData) {
      return NextResponse.json(
        { success: false, error: 'profile_not_found' },
        { status: 404 },
      );
    }

    const profileId = profileData.id as string;

    // 3. Verify user has access to this workspace
    const { data: workerData } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profileId)
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!workerData) {
      return NextResponse.json(
        { success: false, error: 'forbidden' },
        { status: 403 },
      );
    }

    // 4. Upsert workspace_settings with last_active_board_id
    const { data: existingSettings } = await supabase
      .from('workspace_settings')
      .select('workspace_id')
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (existingSettings) {
      // Update existing settings
      const { error: updateError } = await supabase
        .from('workspace_settings')
        .update({ last_active_board_id: board_id })
        .eq('workspace_id', workspace_id);

      if (updateError) {
        console.error('active-board: update error', updateError);
        return NextResponse.json(
          { success: false, error: 'update_failed' },
          { status: 500 },
        );
      }
    } else {
      // Create new settings record
      const { error: insertError } = await supabase
        .from('workspace_settings')
        .insert({
          workspace_id,
          last_active_board_id: board_id,
          enable_cognitive_budget: false,
          story_points_config: { enabled: false, sprint_enabled: false },
          velocity_window_days: 7,
          flow_config: {},
          realtime_subscription_level: 'full',
          data_sharing_level: 'none',
          mcp_api_keys: {},
          quota_config: {},
          standup_config: {},
          doc_kb_config: {},
          f04_config: {},
        });

      if (insertError) {
        console.error('active-board: insert error', insertError);
        return NextResponse.json(
          { success: false, error: 'insert_failed' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('active-board: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}