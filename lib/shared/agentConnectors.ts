// lib/shared/agentConnectors.ts
// Stage 15 (Agent Connectors): общие правила — валидация, дефолты, санитайзинг.
// Используется Route Handlers (/api/agents*) и UI-типами. Секреты сюда не
// попадают: наружу отдаём только secret_hint (INV-19).

export const AGENT_NAME_MAX_LENGTH = 60;

export const AGENT_KINDS = ['openai_chat', 'async_task', 'mcp_runtime'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_AUTONOMY = ['observer', 'tasks', 'full'] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMY)[number];

export const AGENT_LIMIT_DEFAULTS = {
  max_runs_per_day: 20,
  max_run_seconds: 900,
} as const;

/** Потолки лимитов: lease живёт 20 минут, поэтому прогон не может быть дольше. */
export const AGENT_MAX_RUN_SECONDS_CEILING = 900;
export const AGENT_MAX_RUNS_PER_DAY_CEILING = 200;

/**
 * Инструменты НАШЕГО /api/mcp, которые разрешено инъецировать внешнему агенту
 * (INV-18: только чтение и комментарии, никаких мутаций задачи).
 */
export const READ_ONLY_MCP_ALLOWLIST = [
  'get_task_context',
  'get_task_comments',
  'get_tasks_by_column',
  'get_workspace_settings',
  'send_message_to_chat',
] as const;

export interface AgentConnectorPublic {
  id: string;
  workspace_id: string;
  agent_name: string;
  worker_id: string | null;
  kind: AgentKind;
  base_url: string;
  model: string | null;
  provider_version: string | null;
  autonomy: AgentAutonomy;
  skills: unknown[];
  mcp_allowlist: string[];
  limits: Record<string, number>;
  is_active: boolean;
  is_paused: boolean;
  secret_hint: string | null;
  created_at: string;
  updated_at: string;
}

type ValidationOk<T> = { ok: true; value: T };
type ValidationFail = { ok: false; message: string };

export function validateAgentName(raw: unknown): ValidationOk<string> | ValidationFail {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, message: 'Укажите название агента.' };
  if (value.length > AGENT_NAME_MAX_LENGTH) {
    return { ok: false, message: `Название длиннее ${AGENT_NAME_MAX_LENGTH} символов.` };
  }
  return { ok: true, value };
}

export function validateAgentKind(raw: unknown): ValidationOk<AgentKind> | ValidationFail {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: true, value: 'openai_chat' };
  if (!(AGENT_KINDS as readonly string[]).includes(value)) {
    return { ok: false, message: `kind должен быть одним из: ${AGENT_KINDS.join(', ')}.` };
  }
  return { ok: true, value: value as AgentKind };
}

export function validateAutonomy(raw: unknown): ValidationOk<AgentAutonomy> | ValidationFail {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: true, value: 'tasks' };
  if (!(AGENT_AUTONOMY as readonly string[]).includes(value)) {
    return { ok: false, message: `autonomy должен быть одним из: ${AGENT_AUTONOMY.join(', ')}.` };
  }
  return { ok: true, value: value as AgentAutonomy };
}

export function validateLimits(raw: unknown): ValidationOk<Record<string, number>> | ValidationFail {
  if (raw === undefined || raw === null) return { ok: true, value: { ...AGENT_LIMIT_DEFAULTS } };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'limits должен быть объектом.' };
  }

  const source = raw as Record<string, unknown>;
  const maxRuns = source.max_runs_per_day ?? AGENT_LIMIT_DEFAULTS.max_runs_per_day;
  const maxSeconds = source.max_run_seconds ?? AGENT_LIMIT_DEFAULTS.max_run_seconds;

  if (
    !Number.isInteger(maxRuns) ||
    (maxRuns as number) < 1 ||
    (maxRuns as number) > AGENT_MAX_RUNS_PER_DAY_CEILING
  ) {
    return {
      ok: false,
      message: `max_runs_per_day — целое от 1 до ${AGENT_MAX_RUNS_PER_DAY_CEILING}.`,
    };
  }
  if (
    !Number.isInteger(maxSeconds) ||
    (maxSeconds as number) < 30 ||
    (maxSeconds as number) > AGENT_MAX_RUN_SECONDS_CEILING
  ) {
    return {
      ok: false,
      message: `max_run_seconds — целое от 30 до ${AGENT_MAX_RUN_SECONDS_CEILING} (lease 20 мин).`,
    };
  }

  return {
    ok: true,
    value: { max_runs_per_day: maxRuns as number, max_run_seconds: maxSeconds as number },
  };
}

/** Allowlist MCP: допускаем только read-only набор (INV-18). */
export function validateMcpAllowlist(raw: unknown): ValidationOk<string[]> | ValidationFail {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: 'mcp_allowlist должен быть массивом.' };

  const allowed = new Set<string>(READ_ONLY_MCP_ALLOWLIST);
  const value: string[] = [];

  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      return { ok: false, message: 'mcp_allowlist содержит нестроковое значение.' };
    }
    const tool = item.trim();
    if (!allowed.has(tool)) {
      return {
        ok: false,
        message: `Инструмент '${tool}' недоступен внешнему агенту (только чтение: ${READ_ONLY_MCP_ALLOWLIST.join(', ')}).`,
      };
    }
    if (!value.includes(tool)) value.push(tool);
  }

  return { ok: true, value };
}

/** Проекция строки БД в публичный вид: секрет и его vault-ссылка не уходят. */
export function toPublicConnector(row: Record<string, unknown>): AgentConnectorPublic {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    agent_name: String(row.agent_name),
    worker_id: (row.worker_id as string | null) ?? null,
    kind: (row.kind as AgentKind) ?? 'openai_chat',
    base_url: String(row.base_url),
    model: (row.model as string | null) ?? null,
    provider_version: (row.provider_version as string | null) ?? null,
    autonomy: (row.autonomy as AgentAutonomy) ?? 'tasks',
    skills: Array.isArray(row.skills) ? (row.skills as unknown[]) : [],
    mcp_allowlist: Array.isArray(row.mcp_allowlist) ? (row.mcp_allowlist as string[]) : [],
    limits:
      row.limits && typeof row.limits === 'object' && !Array.isArray(row.limits)
        ? (row.limits as Record<string, number>)
        : { ...AGENT_LIMIT_DEFAULTS },
    is_active: Boolean(row.is_active),
    is_paused: Boolean(row.is_paused),
    secret_hint: (row.secret_hint as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
