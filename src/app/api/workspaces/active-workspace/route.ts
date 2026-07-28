'use server';

/**
 * POST /api/workspaces/active-workspace — Save last_active_workspace_id to profiles
 * 
 * Algorithm:
 * 1. Verify Telegram initData
 * 2. Find profile by telegram_id
 * 3. Verify user has access to this workspace
 * 4. Update profiles.last_active_workspace_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../../lib/supabase';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export async function POST(req: NextRequest) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('active-workspace: TELEGRAM_BOT_TOKEN is not set');
    return NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const init_data = body.init_data as string | undefined;
    const workspace_id = body.workspace_id as string | undefined;

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    if (!workspace_id) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id' },
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

    // 4. Update profiles.last_active_workspace_id (migration 016)
    // Use as any to bypass type check until migration is applied locally
    const { error: updateError } = await (supabase as any)
      .from('profiles')
      .update({ last_active_workspace_id: workspace_id })
      .eq('id', profileId);

    if (updateError) {
      console.error('active-workspace: update error', updateError);
      return NextResponse.json(
        { success: false, error: 'update_failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('active-workspace: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}