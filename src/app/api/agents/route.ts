'use server';

/**
 * /api/agents — реестр внешних агентов (Stage 15, Agent Connectors).
 *
 * GET  ?init_data=…[&workspace_id=…] — список коннекторов пользователя
 *      (без полей секрета: только secret_hint, INV-19).
 * POST { init_data, workspace_id, agent_name, base_url, api_key, … } — создать:
 *      бесплатный probe (GET /models) как гейт → INSERT коннектора →
 *      секрет в Vault (service-only RPC) → find-or-create воркера
 *      (ops_ensure_worker) — после чего на агента можно ставить задачи.
 *
 * Права: только owner/admin воркспейса. Таблица agent_connectors — service-only
 * (RLS без политик), поэтому весь доступ идёт через эти хендлеры.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@core/shared/mcpAuth';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
  getUserWorkspaceIds,
} from '@core/api-auth';
import { probeAgentEndpoint } from '@core/shared/agentEndpoint';
import {
  toPublicConnector,
  validateAgentKind,
  validateAgentName,
  validateAutonomy,
  validateLimits,
  validateMcpAllowlist,
} from '@core/shared/agentConnectors';

const ADMIN_ROLES = new Set(['owner', 'admin']);

/** Публичная проекция: secret_ref никогда не читается. */
const SELECT_COLUMNS =
  'id, workspace_id, agent_name, worker_id, kind, base_url, model, provider_version, ' +
  'autonomy, skills, mcp_allowlist, limits, is_active, is_paused, secret_hint, ' +
  'created_at, updated_at';

/** Инструменты, наличие которых у ключа означает «pull-потребитель уже есть». */
const PULL_CONSUMER_TOOLS = [
  'ops_lease',
  'ops_heartbeat',
  'ops_terminal',
  'ops_ack',
  'ops_nack',
  'move_task',
  'create_task',
  'escalate_task',
  'handoff_task',
  'undo',
];

function hasPullConsumerTools(allowedTools: unknown): boolean {
  if (allowedTools === 'all') return true;
  if (Array.isArray(allowedTools)) {
    return allowedTools.some(
      (tool) => typeof tool === 'string' && PULL_CONSUMER_TOOLS.includes(tool),
    );
  }
  return true; // неизвестный формат трактуем как «all» — безопаснее заблокировать
}

// ============================================================================
// GET — список коннекторов
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const initData =
      req.headers.get('x-init-data') ??
      new URL(req.url).searchParams.get('init_data') ??
      undefined;

    const auth = await authenticateRequest(initData);
    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 },
      );
    }

    const requestedWorkspaceId = new URL(req.url).searchParams.get('workspace_id');
    const supabase = getSupabaseClient();

    let workspaceIds: string[];
    if (requestedWorkspaceId) {
      const actor = await getActiveWorkerInWorkspace(auth.profileId, requestedWorkspaceId);
      if (!actor) {
        return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
      }
      workspaceIds = [requestedWorkspaceId];
    } else {
      workspaceIds = await getUserWorkspaceIds(auth.profileId);
    }

    if (workspaceIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from('agent_connectors')
      .select(SELECT_COLUMNS)
      .in('workspace_id', workspaceIds)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('GET /api/agents query error:', error.message);
      return NextResponse.json({ success: false, error: 'database_error' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: (data ?? []).map((row) =>
        toPublicConnector(row as unknown as Record<string, unknown>),
      ),
    });
  } catch (error) {
    console.error('GET /api/agents error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

// ============================================================================
// POST — создать коннектор: probe (гейт) → INSERT → Vault-секрет → воркер
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const initData = await extractInitData(req);
    const auth = await authenticateRequest(initData);

    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id.trim() : '';
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id' },
        { status: 400 },
      );
    }

    const actor = await getActiveWorkerInWorkspace(auth.profileId, workspaceId);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }
    if (!ADMIN_ROLES.has(actor.role ?? '')) {
      return NextResponse.json({ success: false, error: 'admin_required' }, { status: 403 });
    }

    const name = validateAgentName(body.agent_name);
    if (!name.ok) {
      return NextResponse.json(
        { success: false, error: 'invalid_agent_name', message: name.message },
        { status: 400 },
      );
    }

    const kind = validateAgentKind(body.kind);
    if (!kind.ok) {
      return NextResponse.json(
        { success: false, error: 'invalid_kind', message: kind.message },
        { status: 400 },
      );
    }

    const autonomy = validateAutonomy(body.autonomy);
    if (!autonomy.ok) {
      return NextResponse.json(
        { success: false, error: 'invalid_autonomy', message: autonomy.message },
        { status: 400 },
      );
    }

    const limits = validateLimits(body.limits);
    if (!limits.ok) {
      return NextResponse.json(
        { success: false, error: 'invalid_limits', message: limits.message },
        { status: 400 },
      );
    }

    const allowlist = validateMcpAllowlist(body.mcp_allowlist);
    if (!allowlist.ok) {
      return NextResponse.json(
        { success: false, error: 'invalid_mcp_allowlist', message: allowlist.message },
        { status: 400 },
      );
    }

    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'missing_api_key', message: 'Укажите API Key агента.' },
        { status: 400 },
      );
    }

    // Бесплатный гейт (0 токенов): URL живой, ключ принят, API OpenAI-совместим.
    const probe = await probeAgentEndpoint({
      baseUrl: typeof body.base_url === 'string' ? body.base_url : '',
      apiKey,
    });
    if (!probe.ok) {
      return NextResponse.json(
        { success: false, error: probe.code, message: probe.message },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();

    const { data: existing } = await supabase
      .from('agent_connectors')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('agent_name', name.value)
      .is('revoked_at', null)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'agent_name_taken',
          message: 'Агент с таким названием уже подключён к этой доске.',
        },
        { status: 409 },
      );
    }

    // Один потребитель на агента: pull-ключ у того же имени создал бы гонку за outbox.
    const { data: pullKey } = await supabase
      .from('mcp_agent_keys')
      .select('id, allowed_tools')
      .eq('workspace_id', workspaceId)
      .eq('agent_name', name.value)
      .is('revoked_at', null)
      .maybeSingle();

    if (pullKey && hasPullConsumerTools(pullKey.allowed_tools)) {
      return NextResponse.json(
        {
          success: false,
          error: 'mcp_key_conflict',
          message:
            'На это имя выдан MCP-ключ pull-рантайма — отзовите его или выберите другое название.',
        },
        { status: 409 },
      );
    }

    const model =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : probe.suggestedModel;

    const { data: inserted, error: insertError } = await supabase
      .from('agent_connectors')
      .insert({
        workspace_id: workspaceId,
        agent_name: name.value,
        kind: kind.value,
        base_url: probe.baseUrl,
        model,
        autonomy: autonomy.value,
        limits: limits.value,
        mcp_allowlist: allowlist.value,
        skills: Array.isArray(body.skills) ? body.skills : [],
        provider_version:
          typeof body.provider_version === 'string' ? body.provider_version : null,
        created_by: actor.id,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (insertError || !inserted) {
      const isConflict = insertError?.code === '23505';
      console.error('POST /api/agents insert error:', insertError?.message);
      return NextResponse.json(
        { success: false, error: isConflict ? 'agent_name_taken' : 'database_error' },
        { status: isConflict ? 409 : 500 },
      );
    }

    const connectorId = String((inserted as unknown as Record<string, unknown>).id);

    // Секрет — только в Vault. При сбое откатываем коннектор, чтобы не осталось
    // «подключения без ключа» (иначе рантайм не сможет работать).
    const { error: secretError } = await supabase.rpc('agent_connector_set_secret', {
      p_connector_id: connectorId,
      p_secret: apiKey,
    });

    if (secretError) {
      await supabase.from('agent_connectors').delete().eq('id', connectorId);
      console.error('POST /api/agents secret error:', secretError.message);
      return NextResponse.json(
        { success: false, error: 'secret_store_failed' },
        { status: 500 },
      );
    }

    // find-or-create воркера (INV-04): после этого агент виден на доске и
    // выбирается исполнителем в UI.
    const { data: workerId, error: workerError } = await supabase.rpc('ops_ensure_worker', {
      p_workspace_id: workspaceId,
      p_agent_name: name.value,
    });

    if (workerError) {
      console.error('POST /api/agents worker error:', workerError.message);
    } else if (workerId) {
      await supabase
        .from('agent_connectors')
        .update({ worker_id: workerId })
        .eq('id', connectorId);
    }

    const { data: fresh } = await supabase
      .from('agent_connectors')
      .select(SELECT_COLUMNS)
      .eq('id', connectorId)
      .single();

    return NextResponse.json(
      {
        success: true,
        data: toPublicConnector((fresh ?? inserted) as unknown as Record<string, unknown>),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/agents error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
