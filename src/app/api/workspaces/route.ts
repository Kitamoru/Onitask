'use server';

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../lib/supabase';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/**
 * POST /api/workspaces — Create a new workspace
 * 
 * Algorithm:
 * 1. Verify Telegram initData (timingSafeEqual, A-2)
 * 2. Find or create profile
 * 3. Create workspace with provided settings
 * 4. Create owner worker record
 * 5. Return success
 */
export async function PUT(req: NextRequest) {
  // Guard: require TELEGRAM_BOT_TOKEN to be set
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('workspaces: TELEGRAM_BOT_TOKEN is not set in environment variables');
    return NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const init_data = body.init_data as string | undefined;
    const workspace_id = body.workspace_id as string | undefined;
    const name = body.name as string | undefined;
    const workspace_context = body.workspace_context as string | undefined;
    const external_links = body.external_links as Array<{ name: string; url: string }> | undefined;
    const deadline_signals = body.deadline_signals as Array<{ value: number; label: string }> | undefined;

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

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'missing_name' },
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
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, telegram_id')
      .eq('telegram_id', Number(telegramUser.id))
      .maybeSingle();

    if (profileError) {
      console.error('workspaces: profile query error', profileError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    if (!profileData) {
      return NextResponse.json(
        { success: false, error: 'profile_not_found' },
        { status: 404 },
      );
    }

    const profileId = profileData.id as string;

    // 3. Verify user has access to this workspace (is owner or member)
    const { data: workerData, error: workerError } = await supabase
      .from('workers')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('source_id', profileId)
      .maybeSingle();

    if (workerError) {
      console.error('workspaces: worker query error', workerError);
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

    // 4. Update workspace
    const updateData: any = { name };
    
    if (workspace_context !== undefined) {
      updateData.workspace_context = workspace_context;
    }
    
    if (external_links !== undefined) {
      updateData.external_links = external_links;
    }
    
    if (deadline_signals !== undefined) {
      updateData.deadline_signals = deadline_signals;
    }

    const { data: updatedWorkspace, error: updateError } = await supabase
      .from('workspaces')
      .update(updateData)
      .eq('id', workspace_id)
      .select('id, name, slug, task_prefix')
      .single();

    if (updateError) {
      console.error('workspaces: update error', updateError);
      return NextResponse.json(
        { success: false, error: 'workspace_update_failed', details: updateError.message },
        { status: 500 },
      );
    }

    if (!updatedWorkspace) {
      return NextResponse.json(
        { success: false, error: 'workspace_update_failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        workspace: {
          id: updatedWorkspace.id,
          name: updatedWorkspace.name,
          slug: updatedWorkspace.slug,
          task_prefix: updatedWorkspace.task_prefix,
        },
      },
    });
  } catch (err) {
    console.error('workspaces: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  // Guard: require TELEGRAM_BOT_TOKEN to be set
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('workspaces: TELEGRAM_BOT_TOKEN is not set in environment variables');
    return NextResponse.json(
      { success: false, error: 'server_configuration_error' },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const init_data = body.init_data as string | undefined;
    const name = body.name as string | undefined;
    const slug = body.slug as string | undefined;
    const story_points_config = body.story_points_config as { enabled: boolean; values?: number[] } | undefined;
    const enable_cognitive_budget = body.enable_cognitive_budget as boolean | undefined;
    const workspace_context = body.workspace_context as string | undefined;
    const external_links = body.external_links as Array<{ name: string; url: string }> | undefined;
    const deadline_signals = body.deadline_signals as Array<{ value: number; label: string }> | undefined;

    if (!init_data) {
      return NextResponse.json(
        { success: false, error: 'missing_init_data' },
        { status: 400 },
      );
    }

    if (!name || !slug) {
      return NextResponse.json(
        { success: false, error: 'missing_name_or_slug' },
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
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, telegram_id, display_name, avatar_url')
      .eq('telegram_id', Number(telegramUser.id))
      .maybeSingle();

    if (profileError) {
      console.error('workspaces: profile query error', profileError);
      return NextResponse.json(
        { success: false, error: 'database_error' },
        { status: 500 },
      );
    }

    // If profile doesn't exist, create it
    let profileId: string;
    let displayName: string;

    if (!profileData) {
      profileId = crypto.randomUUID();
      displayName =
        telegramUser.username ||
        [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') ||
        `User_${telegramUser.id}`;

      const { error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: profileId,
          telegram_id: Number(telegramUser.id),
          display_name: displayName,
          avatar_url: null,
        });

      if (insertError) {
        console.error('workspaces: profile creation error', insertError);
        return NextResponse.json(
          { success: false, error: 'profile_creation_failed' },
          { status: 500 },
        );
      }
    } else {
      profileId = profileData.id as string;
      displayName = profileData.display_name as string;
    }

     // 3. Create workspace (pass owner_id explicitly since service role bypasses auth.uid())
     // Note: owner_id must be set explicitly because service_role bypasses RLS and auth.uid() returns NULL
     const { data: workspaceData, error: workspaceError } = await supabase
       .from('workspaces')
       .insert({
         name,
         slug,
         task_prefix: slug.toUpperCase().slice(0, 4),
         owner_id: profileId,
       })
       .select('id, name, slug, task_prefix')
       .single();

     if (workspaceError) {
       console.error('workspaces: workspace creation error', {
         message: workspaceError.message,
         details: workspaceError.details,
         hint: workspaceError.hint,
         code: workspaceError.code,
       });
       return NextResponse.json(
         { 
           success: false, 
           error: 'workspace_creation_failed',
           details: workspaceError.message,
           code: workspaceError.code,
         },
         { status: 500 },
       );
     }

     if (!workspaceData) {
       console.error('workspaces: workspace creation returned no data');
       return NextResponse.json(
         { success: false, error: 'workspace_creation_failed', details: 'No data returned' },
         { status: 500 },
       );
     }

    const workspaceId = workspaceData.id as string;

    // 4. Create owner worker record
    const { error: workerError } = await supabase
      .from('workers')
      .insert({
        workspace_id: workspaceId,
        source_id: profileId,
        type: 'human',
        role: 'owner',
        display_name: displayName,
      });

    if (workerError) {
      console.error('workspaces: worker creation error', workerError);
      // Note: we don't fail here - workspace is already created
    }

    // 5. Return success
    return NextResponse.json({
      success: true,
      data: {
        workspace: {
          id: workspaceId,
          name,
          slug,
          task_prefix: workspaceData.task_prefix,
        },
      },
    });
  } catch (err) {
    console.error('workspaces: unexpected error', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}