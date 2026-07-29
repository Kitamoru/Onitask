'use server';

import { NextRequest, NextResponse } from 'next/server';
import { validateTelegramInitData } from '../../../../src/lib/telegram/validate';
import { createServerClient } from '../../../../lib/supabase';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/**
 * PUT /api/workspaces — Update workspace settings
 * 
 * Algorithm:
 * 1. Verify Telegram initData (timingSafeEqual, A-2)
 * 2. Find profile by telegram_id
 * 3. Verify user has access to this workspace
 * 4. Update workspaces.name (only mutable column on workspaces table)
 * 5. Route additional fields to correct tables:
 *    - workspace_context → workspace_settings.workspace_context
 *    - deadline_signals → workspace_settings.deadline_signals
 *    - external_links → workspace_links (CRUD full refresh)
 *    - story_points_config → workspace_settings.story_points_config
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
    const story_points_config = body.story_points_config as { enabled?: boolean; sprint_enabled?: boolean; hours_per_sp?: Record<string, string> } | undefined;
    const enable_cognitive_budget = body.enable_cognitive_budget as boolean | undefined;
    const doc_kb_enabled = body.doc_kb_enabled as boolean | undefined;

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
    const anySupabase = supabase as any;

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

    // 4. Update workspace name (only mutable column on workspaces table)
    // workspaces table has: id, name, slug, plan, task_prefix, created_at
    // slug and task_prefix are immutable, plan is rarely changed
    const { data: updatedWorkspace, error: updateError } = await supabase
      .from('workspaces')
      .update({ name })
      .eq('id', workspace_id)
      .select('id, name, slug, task_prefix')
      .single();

    if (updateError) {
      console.error('workspaces: update error', {
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
        code: updateError.code,
        workspace_id,
      });
      return NextResponse.json(
        { success: false, error: 'workspace_update_failed', details: updateError.message, code: updateError.code },
        { status: 400 },
      );
    }

    if (!updatedWorkspace) {
      return NextResponse.json(
        { success: false, error: 'workspace_update_failed' },
        { status: 500 },
      );
    }

    // Helper: ensure workspace_settings exists, create if not
    async function ensureSettings() {
      const { data: existing } = await anySupabase
        .from('workspace_settings')
        .select('workspace_id')
        .eq('workspace_id', workspace_id)
        .maybeSingle();

      if (!existing) {
        await anySupabase.from('workspace_settings').insert({
          workspace_id,
          story_points_config: { enabled: false },
          enable_cognitive_budget: false,
          velocity_window_days: 7,
          flow_config: {},
          realtime_subscription_level: 'own_tasks',
          data_sharing_level: 'standard',
          mcp_api_keys: {},
          quota_config: {},
          standup_config: {},
          doc_kb_config: {},
          f04_config: {},
        });
      }
    }

    // 4b. Update workspace_settings.workspace_context if provided
    if (workspace_context !== undefined) {
      await ensureSettings();
      const { error: contextError } = await anySupabase
        .from('workspace_settings')
        .update({ workspace_context })
        .eq('workspace_id', workspace_id);
      if (contextError) console.error('workspaces: workspace_context update error', contextError);
    }

    // 4c. Update workspace_settings.deadline_signals if provided
    //     Always include `level` field (amber/red) per migration 007 spec
    if (deadline_signals && deadline_signals.length > 0) {
      await ensureSettings();
      const signalsWithLevel = deadline_signals.map((s, idx) => ({
        ...s,
        level: (s as any).level || (idx === 0 ? 'amber' : 'red'),
      }));
      const { error: signalsError } = await anySupabase
        .from('workspace_settings')
        .update({ deadline_signals: signalsWithLevel })
        .eq('workspace_id', workspace_id);
      if (signalsError) console.error('workspaces: deadline_signals update error', signalsError);
    }

    // 4d. Manage workspace_links for external_links (full refresh)
    if (external_links !== undefined) {
      // Delete existing links for this workspace
      await anySupabase
        .from('workspace_links')
        .delete()
        .eq('workspace_id', workspace_id);

      // Insert new links — support both { name, url } and { label, url } shapes
      if (external_links.length > 0) {
        const linksToInsert = external_links
          .map((link) => ({
            workspace_id,
            name: (link as any).name || (link as any).label || '',
            url: link.url,
          }))
          .filter((link) => link.name && link.url);

        if (linksToInsert.length > 0) {
          const { error: linksError } = await anySupabase
            .from('workspace_links')
            .insert(linksToInsert);

          if (linksError) {
            console.error('workspaces: external_links insert error', linksError);
            return NextResponse.json(
              { success: false, error: 'links_save_failed', details: linksError.message },
              { status: 400 },
            );
          }
        }
      }
    }

    // 5. Update workspace_settings.story_points_config if provided
    if (story_points_config) {
      await ensureSettings();
      
      const { data: existingSettings } = await anySupabase
        .from('workspace_settings')
        .select('story_points_config')
        .eq('workspace_id', workspace_id)
        .maybeSingle();

      if (existingSettings) {
        // Merge with existing story_points_config (preserves hours_per_sp etc.)
        const existingConfig = (existingSettings as any).story_points_config || {};
        const mergedConfig = { ...existingConfig, ...story_points_config };
        
        const { error: settingsError } = await anySupabase
          .from('workspace_settings')
          .update({ story_points_config: mergedConfig })
          .eq('workspace_id', workspace_id);

        if (settingsError) {
          console.error('workspaces: story_points_config update error', settingsError);
        }
      } else {
        const { error: settingsError } = await anySupabase
          .from('workspace_settings')
          .update({ story_points_config })
          .eq('workspace_id', workspace_id);

        if (settingsError) {
          console.error('workspaces: story_points_config update error', settingsError);
        }
      }
    }

    // 5b. Update workspace_settings.enable_cognitive_budget if provided
    if (enable_cognitive_budget !== undefined) {
      await ensureSettings();
      const { error: cogError } = await anySupabase
        .from('workspace_settings')
        .update({ enable_cognitive_budget })
        .eq('workspace_id', workspace_id);
      if (cogError) console.error('workspaces: enable_cognitive_budget update error', cogError);
    }

    // 5c. Update workspace_settings.doc_kb_config.enabled if provided
    if (doc_kb_enabled !== undefined) {
      await ensureSettings();
      // Merge with existing doc_kb_config to preserve other fields (max_files, etc.)
      const { data: existingSettings } = await anySupabase
        .from('workspace_settings')
        .select('doc_kb_config')
        .eq('workspace_id', workspace_id)
        .maybeSingle();

      const existingDocConfig = (existingSettings as any)?.doc_kb_config || {};
      const mergedDocConfig = { ...existingDocConfig, enabled: doc_kb_enabled };

      const { error: docError } = await anySupabase
        .from('workspace_settings')
        .update({ doc_kb_config: mergedDocConfig })
        .eq('workspace_id', workspace_id);
      if (docError) console.error('workspaces: doc_kb_config update error', docError);
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
    const story_points_config = body.story_points_config as { enabled?: boolean; values?: number[]; sprint_enabled?: boolean; hours_per_sp?: Record<string, string> } | undefined;
    const enable_cognitive_budget = body.enable_cognitive_budget as boolean | undefined;
    const workspace_context = body.workspace_context as string | undefined;
    const external_links = body.external_links as Array<{ name: string; url: string }> | undefined;
    const deadline_signals = body.deadline_signals as Array<{ value: number; label: string }> | undefined;
    const doc_kb_enabled = body.doc_kb_enabled as boolean | undefined;

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
      }

      // 5. Create workspace_settings with form-provided configuration
      const spConfig = story_points_config || { enabled: false };
      const defaultDeadlineSignals = [
        { value: 3, label: '3 дня', level: 'amber' as const },
        { value: 1, label: '1 день', level: 'red' as const },
      ];

      const { error: settingsError } = await supabase.from('workspace_settings').insert({
        workspace_id: workspaceId,
        story_points_config: {
          enabled: spConfig.enabled ?? false,
          sprint_enabled: spConfig.sprint_enabled ?? false,
          values: spConfig.values,
          hours_per_sp: spConfig.hours_per_sp,
        },
        enable_cognitive_budget: enable_cognitive_budget ?? false,
        workspace_context: workspace_context ?? null,
        deadline_signals: deadline_signals && deadline_signals.length > 0
          ? deadline_signals.map((s, idx) => ({ ...s, level: (s as any).level || (idx === 0 ? 'amber' : 'red') }))
          : defaultDeadlineSignals,
        velocity_window_days: 14,
        flow_config: {},
        realtime_subscription_level: 'own_tasks',
        data_sharing_level: 'standard',
        mcp_api_keys: {},
        quota_config: { agent_reserved_pct: 60, human_min_pct: 40 },
        standup_config: { enabled: false, time_utc: '07:00', chat_id: null },
        doc_kb_config: { enabled: doc_kb_enabled ?? true, max_file_bytes: 524288, max_total_bytes: 5242880, max_files: 20 },
        f04_config: {
          skip_min_clarity: 0.85,
          skip_max_complexity: 1,
          correction_sheet_clarity_threshold: 0.70,
          low_clarity_tag_threshold: 0.55,
        },
      });

      if (settingsError) {
        console.error('workspaces: workspace_settings creation error', settingsError);
      }

      // 6. Insert external_links if provided
      if (external_links && external_links.length > 0) {
        const linksToInsert = external_links.map((link) => ({
          workspace_id: workspaceId,
          name: link.name,
          url: link.url,
        }));

        const { error: linksError } = await supabase
          .from('workspace_links')
          .insert(linksToInsert);

        if (linksError) {
          console.error('workspaces: external_links insert error', linksError);
        }
      }

      // 7. Return success
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