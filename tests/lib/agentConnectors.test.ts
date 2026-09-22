// Tests for lib/shared/agentConnectors.ts — Stage 15 (Agent Connectors).
// Ключевые гарантии: INV-19 (secret_ref не уходит наружу) и INV-18
// (внешнему агенту нельзя выдать мутирующие MCP-инструменты).

import { describe, it, expect } from 'vitest';
import {
  AGENT_LIMIT_DEFAULTS,
  READ_ONLY_MCP_ALLOWLIST,
  toPublicConnector,
  validateAgentKind,
  validateAgentName,
  validateAutonomy,
  validateLimits,
  validateMcpAllowlist,
} from '../../lib/shared/agentConnectors';

describe('validateAgentName', () => {
  it('тримит и принимает корректное имя', () => {
    const result = validateAgentName('  Drift  ');
    expect(result.ok && result.value).toBe('Drift');
  });

  it('отклоняет пустое имя', () => {
    expect(validateAgentName('   ').ok).toBe(false);
  });

  it('отклоняет имя длиннее 60 символов', () => {
    expect(validateAgentName('a'.repeat(61)).ok).toBe(false);
  });
});

describe('validateAgentKind / validateAutonomy', () => {
  it('по умолчанию openai_chat и tasks', () => {
    const kind = validateAgentKind(undefined);
    const autonomy = validateAutonomy(undefined);
    expect(kind.ok && kind.value).toBe('openai_chat');
    expect(autonomy.ok && autonomy.value).toBe('tasks');
  });

  it('отклоняет неизвестный kind', () => {
    expect(validateAgentKind('magic').ok).toBe(false);
  });
});

describe('validateLimits', () => {
  it('без входных данных — дефолты', () => {
    const result = validateLimits(undefined);
    expect(result.ok && result.value).toEqual({ ...AGENT_LIMIT_DEFAULTS });
  });

  it('не даёт превысить lease (900 секунд)', () => {
    const result = validateLimits({ max_run_seconds: 901 });
    expect(result.ok).toBe(false);
  });

  it('ограничивает прогоны в сутки', () => {
    expect(validateLimits({ max_runs_per_day: 0 }).ok).toBe(false);
    expect(validateLimits({ max_runs_per_day: 201 }).ok).toBe(false);
  });

  it('принимает корректные значения', () => {
    const result = validateLimits({ max_runs_per_day: 5, max_run_seconds: 120 });
    expect(result.ok && result.value).toEqual({ max_runs_per_day: 5, max_run_seconds: 120 });
  });
});

describe('validateMcpAllowlist (INV-18)', () => {
  it('пустой список = без инъекции MCP', () => {
    const result = validateMcpAllowlist(undefined);
    expect(result.ok && result.value).toEqual([]);
  });

  it('принимает read-only набор', () => {
    const result = validateMcpAllowlist([...READ_ONLY_MCP_ALLOWLIST]);
    expect(result.ok && result.value.length).toBe(READ_ONLY_MCP_ALLOWLIST.length);
  });

  it('дедуплицирует повторы', () => {
    const result = validateMcpAllowlist(['get_task_context', 'get_task_context']);
    expect(result.ok && result.value).toEqual(['get_task_context']);
  });

  it('запрещает мутации задачи', () => {
    for (const tool of ['move_task', 'create_task', 'escalate_task', 'ops_terminal', 'ops_lease']) {
      expect(validateMcpAllowlist([tool]).ok).toBe(false);
    }
  });

  it('запрещает не-строки', () => {
    expect(validateMcpAllowlist([123]).ok).toBe(false);
  });
});

describe('toPublicConnector (INV-19)', () => {
  const row = {
    id: 'c-1',
    workspace_id: 'w-1',
    agent_name: 'Drift',
    worker_id: 'k-1',
    kind: 'openai_chat',
    base_url: 'https://drift.neuraldeep.ru/v1',
    model: 'drift',
    provider_version: null,
    autonomy: 'tasks',
    skills: [],
    mcp_allowlist: [],
    limits: { max_runs_per_day: 20, max_run_seconds: 900 },
    is_active: true,
    is_paused: false,
    secret_ref: 'vault-secret-uuid',
    secret_hint: 'dft_…el5l',
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
  };

  it('не отдаёт secret_ref даже если он есть в строке', () => {
    const published = toPublicConnector(row);
    expect('secret_ref' in published).toBe(false);
    expect(published.secret_hint).toBe('dft_…el5l');
  });

  it('подставляет дефолтные лимиты при мусоре', () => {
    const published = toPublicConnector({ ...row, limits: 'oops' });
    expect(published.limits).toEqual({ ...AGENT_LIMIT_DEFAULTS });
  });
});
