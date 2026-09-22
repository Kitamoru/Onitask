// lib/shared/agentEndpoint.ts
// Stage 15 (Agent Connectors): нормализация и SSRF-safe probe внешнего
// агентского endpoint'а (OpenAI-совместимый `GET {base_url}/models`).
//
// Почему не «просто fetch»: base_url и ключ вводит пользователь, поэтому:
//   * только https, без credentials/query/hash в URL;
//   * приватные адреса запрещены — проверяем и литерал, и ВСЕ адреса DNS-резолва
//     (защита от DNS-rebind);
//   * редиректы не проходим (`redirect: 'manual'`) — иначе SSRF-обход;
//   * ключ никогда не попадает в сообщения об ошибках и логи.
//
// Server-only: импортируется из Route Handlers, в клиент не попадает.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const AGENT_PROBE_TIMEOUT_MS = 10_000;

export type AgentProbeErrorCode =
  | 'invalid_url'
  | 'url_not_https'
  | 'url_has_credentials'
  | 'url_has_query'
  | 'host_not_allowed'
  | 'host_unresolvable'
  | 'redirect_blocked'
  | 'unauthorized'
  | 'models_not_found'
  | 'server_error'
  | 'timeout'
  | 'unreachable'
  | 'bad_response';

export interface AgentProbeFailure {
  ok: false;
  code: AgentProbeErrorCode;
  message: string;
  status?: number;
}

export interface AgentProbeSuccess {
  ok: true;
  baseUrl: string;
  models: string[];
  suggestedModel: string | null;
  status: number;
}

export type AgentProbeResult = AgentProbeSuccess | AgentProbeFailure;

// ─── SSRF: приватные адреса ──────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // ULA
  if (value.startsWith('fe80')) return true; // link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

/** Проверка hostname: литерал IP, запрещённые имена и все адреса DNS-резолва. */
async function assertPublicHost(hostname: string): Promise<AgentProbeFailure | null> {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, code: 'host_not_allowed', message: 'Внутренние адреса запрещены.' };
  }

  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { ok: false, code: 'host_not_allowed', message: 'Внутренние адреса запрещены.' }
      : null;
  }

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) {
      return { ok: false, code: 'host_unresolvable', message: 'Домен не разрешается в адрес.' };
    }
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      return { ok: false, code: 'host_not_allowed', message: 'Внутренние адреса запрещены.' };
    }
  } catch {
    return { ok: false, code: 'host_unresolvable', message: 'Не удалось разрешить домен.' };
  }

  return null;
}

// ─── Нормализация URL ────────────────────────────────────────────────────────

export function normalizeAgentBaseUrl(
  raw: string,
): { ok: true; baseUrl: string } | AgentProbeFailure {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, code: 'invalid_url', message: 'Укажите URL агента.' };

  // Пользователь может ввести домен без схемы — считаем, что имел в виду https.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, code: 'invalid_url', message: 'URL не разобран — проверьте формат.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, code: 'url_not_https', message: 'Разрешён только https.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'url_has_credentials', message: 'Логин/пароль в URL запрещены.' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, code: 'url_has_query', message: 'Query-параметры в URL запрещены.' };
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, baseUrl: `${parsed.origin}${path}` };
}

// ─── Probe ───────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function extractModels(payload: unknown): string[] {
  const root = asRecord(payload);
  const list = root?.data ?? root?.models;
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => {
      if (typeof item === 'string') return item;
      const entry = asRecord(item);
      const id = entry?.id ?? entry?.name ?? entry?.model;
      return typeof id === 'string' ? id : null;
    })
    .filter((id): id is string => Boolean(id));
}

/**
 * Бесплатный probe (0 токенов): `GET {base_url}/models` с Bearer-ключом.
 * Успех означает «URL отвечает OpenAI-совместимо и ключ принят».
 */
export async function probeAgentEndpoint(params: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<AgentProbeResult> {
  const normalized = normalizeAgentBaseUrl(params.baseUrl);
  if (!normalized.ok) return normalized;

  const { baseUrl } = normalized;

  const hostCheck = await assertPublicHost(new URL(baseUrl).hostname);
  if (hostCheck) return hostCheck;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? AGENT_PROBE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        code: 'redirect_blocked',
        message: 'Сервис отвечает редиректом — укажите конечный адрес API.',
        status: response.status,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'unauthorized',
        message: 'Ключ отклонён сервисом — проверьте API Key.',
        status: response.status,
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        code: 'models_not_found',
        message: 'По этому URL нет OpenAI-совместимого API (404 на /models).',
        status: response.status,
      };
    }

    if (response.status === 429 || response.status >= 500) {
      return {
        ok: false,
        code: 'server_error',
        message: `Сервис ответил ${response.status} — повторите позже.`,
        status: response.status,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: 'bad_response',
        message: `Неожиданный ответ сервиса (${response.status}).`,
        status: response.status,
      };
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, code: 'bad_response', message: 'Ответ сервиса не JSON.' };
    }

    const models = extractModels(payload);
    if (models.length === 0) {
      return {
        ok: false,
        code: 'models_not_found',
        message: 'Сервис не вернул список моделей.',
        status: response.status,
      };
    }

    return {
      ok: true,
      baseUrl,
      models,
      suggestedModel: models[0] ?? null,
      status: response.status,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return isAbort
      ? { ok: false, code: 'timeout', message: 'Сервис не ответил за 10 секунд.' }
      : { ok: false, code: 'unreachable', message: 'Не удалось подключиться к сервису.' };
  } finally {
    clearTimeout(timeout);
  }
}
