'use server';

/**
 * /api/agents/[id] — управление коннектором (Stage 15).
 *
 * PATCH  — is_paused (kill switch), model, autonomy, limits, mcp_allowlist,
 *          provider_version, base_url и api_key (оба требуют успешного probe:
 *          смена URL без нового ключа проверяется сохранённым ключом из Vault).
 * DELETE — отзыв: секрет удаляется из Vault, коннектор помечается revoked,
 *          воркер снимается с доски (история задач сохраняется).
 *
 * Права: owner/admin воркспейса коннектора. Секрет наружу не отдаётся (INV-19).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@core/shared/mcpAuth';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
} from '@core/api-auth';
import { probeAgentEndpoint } from '@core/shared/agentEndpoint';
import {
  toPublicConnector,
  validateAutonomy,
  validateLimits,
  validateMcpAllowlist,
} from '@core/shared/agentConnectors';

const ADMIN_ROLES = new Set(['owner', 'admin']);

const SELECT_COLUMNS =
  'id, workspace_id, agent_name, worker_id, kind, base_url, model, provider_version, ' +
  'autonomy, skills, mcp_allowlist, limits, is_active, is_paused, secret_hint, ' +
  'created_at, updated_at';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ============================================================================
// PATCH — обновление коннектора
// ============================================================================

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const initData = await extractInitData(req);
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 },
      );
    }

    const connectorId = (await params).id;
    const supabase = getSupabaseClient();

    const { data: row } = await supabase
      .from('agent_connectors')
      .select(SELECT_COLUMNS)
      .eq('id', connectorId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    const record = row as unknown as Record<string, unknown>;
    const workspaceId = String(record.workspace_id);

    const actor = await getActiveWorkerInWorkspace(auth.profileId, workspaceId);
    if (!actor || !ADMIN_ROLES.has(actor.role ?? '')) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.is_paused === 'boolean') patch.is_paused = body.is_paused;
    if (body.model !== undefined) {
      patch.model =
        typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
    }
    if (body.provider_version !== undefined) {
      patch.provider_version =
        typeof body.provider_version === 'string' && body.provider_version.trim()
          ? body.provider_version.trim()
          : null;
    }

    if (body.autonomy !== undefined) {
      const autonomy = validateAutonomy(body.autonomy);
      if (!autonomy.ok) {
        return NextResponse.json(
          { success: false, error: 'invalid_autonomy', message: autonomy.message },
          { status: 400 },
        );
      }
      patch.autonomy = autonomy.value;
    }

    if (body.limits !== undefined) {
      const limits = validateLimits(body.limits);
      if (!limits.ok) {
        return NextResponse.json(
          { success: false, error: 'invalid_limits', message: limits.message },
          { status: 400 },
        );
      }
      patch.limits = limits.value;
    }

    if (body.mcp_allowlist !== undefined) {
      const allowlist = validateMcpAllowlist(body.mcp_allowlist);
      if (!allowlist.ok) {
        return NextResponse.json(
          { success: false, error: 'invalid_mcp_allowlist', message: allowlist.message },
          { status: 400 },
        );
      }
      patch.mcp_allowlist = allowlist.value;
    }

    // URL и/или ключ меняются → обязательный повторный probe.
    const nextBaseUrl =
      typeof body.base_url === 'string' && body.base_url.trim()
        ? body.base_url.trim()
        : String(record.base_url);
    const newKey =
      typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : null;
    const urlChanged = nextBaseUrl !== String(record.base_url);

    if (newKey || urlChanged) {
      let probeKey = newKey;
      if (!probeKey) {
        const { data: stored } = await supabase.rpc('agent_connector_get_secret', {
          p_connector_id: connectorId,
        });
        probeKey = typeof stored === 'string' && stored ? stored : null;
      }

      if (!probeKey) {
        return NextResponse.json(
          {
            success: false,
            error: 'missing_api_key',
            message: 'Для проверки нового URL укажите API Key.',
          },
          { status: 400 },
        );
      }

      const probe = await probeAgentEndpoint({ baseUrl: nextBaseUrl, apiKey: probeKey });
      if (!probe.ok) {
        return NextResponse.json(
          { success: false, error: probe.code, message: probe.message },
          { status: 400 },
        );
      }

      patch.base_url = probe.baseUrl;

      if (newKey) {
        const { error: secretError } = await supabase.rpc('agent_connector_set_secret', {
          p_connector_id: connectorId,
          p_secret: newKey,
        });
        if (secretError) {
          console.error('PATCH /api/agents secret error:', secretError.message);
          return NextResponse.json(
            { success: false, error: 'secret_store_failed' },
            { status: 500 },
          );
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, data: toPublicConnector(record) });
    }

    const { data: updated, error: updateError } = await supabase
      .from('agent_connectors')
      .update(patch)
      .eq('id', connectorId)
      .select(SELECT_COLUMNS)
      .single();

    if (updateError || !updated) {
      console.error('PATCH /api/agents update error:', updateError?.message);
      return NextResponse.json({ success: false, error: 'database_error' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: toPublicConnector(updated as unknown as Record<string, unknown>),
    });
  } catch (error) {
    console.error('PATCH /api/agents/[id] error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

// ============================================================================
// DELETE — отзыв коннектора (kill switch + очистка секрета)
// ============================================================================

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const initData = await extractInitData(req);
    const auth = await authenticateRequest(initData);
    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 },
      );
    }

    const connectorId = (await params).id;
    const supabase = getSupabaseClient();

    const { data: row } = await supabase
      .from('agent_connectors')
      .select('id, workspace_id, worker_id')
      .eq('id', connectorId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    const record = row as Record<string, unknown>;
    const workspaceId = String(record.workspace_id);

    const actor = await getActiveWorkerInWorkspace(auth.profileId, workspaceId);
    if (!actor || !ADMIN_ROLES.has(actor.role ?? '')) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    const { error: secretError } = await supabase.rpc('agent_connector_delete_secret', {
      p_connector_id: connectorId,
    });
    if (secretError) {
      console.error('DELETE /api/agents secret error:', secretError.message);
      return NextResponse.json(
        { success: false, error: 'secret_delete_failed' },
        { status: 500 },
      );
    }

    const { error: revokeError } = await supabase
      .from('agent_connectors')
      .update({ revoked_at: new Date().toISOString(), is_active: false })
      .eq('id', connectorId);

    if (revokeError) {
      console.error('DELETE /api/agents revoke error:', revokeError.message);
      return NextResponse.json({ success: false, error: 'database_error' }, { status: 500 });
    }

    // Агент уходит с доски (в назначении больше не выбирается), но история задач
    // и agent_events сохраняются — воркер не удаляем.
    const workerId = record.worker_id as string | null;
    if (workerId) {
      await supabase.from('workers').update({ is_active: false }).eq('id', workerId);
    }

    return NextResponse.json({ success: true, data: { id: connectorId, revoked: true } });
  } catch (error) {
    console.error('DELETE /api/agents/[id] error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}