/**
 * Agent Connectors API client (Stage 15).
 *
 * Тот же паттерн, что в src/lib/api/comments.ts: TWA не имеет Supabase JWT,
 * поэтому все операции идут через серверные маршруты /api/agents* с Telegram
 * initData в заголовке `x-init-data`. Секрет агента наружу не возвращается —
 * только `secret_hint` (INV-19).
 */

export interface AgentConnector {
  id: string;
  workspace_id: string;
  agent_name: string;
  worker_id: string | null;
  kind: 'openai_chat' | 'async_task' | 'mcp_runtime';
  base_url: string;
  model: string | null;
  provider_version: string | null;
  autonomy: 'observer' | 'tasks' | 'full';
  skills: unknown[];
  mcp_allowlist: string[];
  limits: Record<string, number>;
  is_active: boolean;
  is_paused: boolean;
  secret_hint: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentProbeInfo {
  base_url: string;
  models: string[];
  suggested_model: string | null;
}

export interface AgentsApiResult<T> {
  data: T | null;
  error: string | null;
  /** Человекочитаемое пояснение от сервера (для кодов агентского probe). */
  message: string | null;
}

/** Get Telegram initData from window for API auth (same as flow.ts). */
function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

async function request<T>(
  url: string,
  init: { method: string; body?: unknown },
): Promise<AgentsApiResult<T>> {
  const initData = getTelegramInitData();
  if (!initData) {
    return { data: null, error: 'unauthorized', message: 'Нет данных Telegram — откройте из бота.' };
  }

  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        'x-init-data': initData,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const payload = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: T; error?: string; message?: string }
      | null;

    if (!res.ok || !payload?.success) {
      return {
        data: null,
        error: payload?.error ?? `http_${res.status}`,
        message: payload?.message ?? null,
      };
    }

    return { data: (payload.data ?? null) as T, error: null, message: null };
  } catch {
    return { data: null, error: 'network_error', message: 'Не удалось связаться с сервером.' };
  }
}

// ─── Probe (бесплатно, 0 токенов) ────────────────────────────────────────────

export async function probeAgent(params: {
  workspaceId: string;
  baseUrl: string;
  apiKey: string;
}): Promise<AgentsApiResult<AgentProbeInfo>> {
  return request<AgentProbeInfo>('/api/agents/probe', {
    method: 'POST',
    body: {
      workspace_id: params.workspaceId,
      base_url: params.baseUrl,
      api_key: params.apiKey,
    },
  });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listAgents(workspaceId?: string): Promise<AgentsApiResult<AgentConnector[]>> {
  const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return request<AgentConnector[]>(`/api/agents${qs}`, { method: 'GET' });
}

export async function createAgent(params: {
  workspaceId: string;
  agentName: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  autonomy?: 'observer' | 'tasks' | 'full';
}): Promise<AgentsApiResult<AgentConnector>> {
  return request<AgentConnector>('/api/agents', {
    method: 'POST',
    body: {
      workspace_id: params.workspaceId,
      agent_name: params.agentName,
      base_url: params.baseUrl,
      api_key: params.apiKey,
      model: params.model,
      autonomy: params.autonomy,
    },
  });
}

export async function updateAgent(
  connectorId: string,
  patch: {
    is_paused?: boolean;
    model?: string | null;
    autonomy?: 'observer' | 'tasks' | 'full';
    limits?: Record<string, number>;
    mcp_allowlist?: string[];
    base_url?: string;
    api_key?: string;
  },
): Promise<AgentsApiResult<AgentConnector>> {
  return request<AgentConnector>(`/api/agents/${connectorId}`, {
    method: 'PATCH',
    body: patch,
  });
}

export async function revokeAgent(
  connectorId: string,
): Promise<AgentsApiResult<{ id: string; revoked: boolean }>> {
  return request<{ id: string; revoked: boolean }>(`/api/agents/${connectorId}`, {
    method: 'DELETE',
  });
}
