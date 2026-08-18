import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../../lib/supabase';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/**
 * GET /api/workspaces/list — Returns list of workspaces the user has access to.
 * Used by MCP Keys page to let user select which workspace the key belongs to.
 */
export async function GET(req: NextRequest) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const init_data = searchParams.get('init_data') as string | null;

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    const validation = await validateTelegramInitData(init_data, TELEGRAM_BOT_TOKEN);
    if (!validation.valid || !validation.user) {
      return NextResponse.json(
        { success: false, error: validation.error || 'invalid_init_data' },
        { status: 401 },
      );
    }

    const telegramUser = validation.user;
    const supabase = createServerClient();

    // Find profile
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

    const profileId = profileData.id;

    // Get all workspaces the user has access to via workers table
    const { data: workers } = await supabase
      .from('workers')
      .select('workspace_id')
      .eq('source_id', profileId)
      .eq('is_active', true);

    const workspaceIds = workers?.map((w: { workspace_id: string }) => w.workspace_id).filter(Boolean) ?? [];

    if (workspaceIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { workspaces: [] },
      });
    }

    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id, name, slug, task_prefix')
      .in('id', workspaceIds)
      .order('name');

    return NextResponse.json({
      success: true,
      data: { workspaces: workspaces ?? [] },
    });
  } catch (err) {
    console.error('workspaces/list: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}