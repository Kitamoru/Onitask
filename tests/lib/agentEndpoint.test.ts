// Tests for lib/shared/agentEndpoint.ts — Stage 15 (Agent Connectors).
// Проверяем нормализацию URL, SSRF-гейт и маппинг ответов probe БЕЗ сети:
// DNS и fetch замоканы, поэтому тесты детерминированы и не тратят токены.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeAgentBaseUrl, probeAgentEndpoint } from '../../lib/shared/agentEndpoint';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe('normalizeAgentBaseUrl', () => {
  it('добавляет https и срезает trailing slash', () => {
    const result = normalizeAgentBaseUrl('drift.neuraldeep.ru/v1/');
    expect(result).toEqual({ ok: true, baseUrl: 'https://drift.neuraldeep.ru/v1' });
  });

  it('сохраняет путь из полного URL', () => {
    const result = normalizeAgentBaseUrl('https://api.example.com/openai/v1');
    expect(result.ok && result.baseUrl).toBe('https://api.example.com/openai/v1');
  });

  it('запрещает http', () => {
    const result = normalizeAgentBaseUrl('http://api.example.com/v1');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('url_not_https');
  });

  it('запрещает логин/пароль в URL', () => {
    const result = normalizeAgentBaseUrl('https://user:pass@api.example.com/v1');
    expect(!result.ok && result.code).toBe('url_has_credentials');
  });

  it('запрещает query-параметры', () => {
    const result = normalizeAgentBaseUrl('https://api.example.com/v1?key=123');
    expect(!result.ok && result.code).toBe('url_has_query');
  });

  it('отклоняет пустую строку', () => {
    const result = normalizeAgentBaseUrl('   ');
    expect(!result.ok && result.code).toBe('invalid_url');
  });
});

describe('probeAgentEndpoint — SSRF', () => {
  it('блокирует loopback без сетевого вызова', async () => {
    const result = await probeAgentEndpoint({ baseUrl: 'https://127.0.0.1/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('host_not_allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('блокирует cloud metadata (169.254.169.254)', async () => {
    const result = await probeAgentEndpoint({
      baseUrl: 'https://169.254.169.254/v1',
      apiKey: 'k',
    });
    expect(!result.ok && result.code).toBe('host_not_allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('probeAgentEndpoint — ответы сервиса', () => {
  it('успех: возвращает модели и предлагает модель по умолчанию', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ id: 'drift' }] }));

    const result = await probeAgentEndpoint({
      baseUrl: 'https://drift.neuraldeep.ru/v1',
      apiKey: 'dft_test',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toEqual(['drift']);
      expect(result.suggestedModel).toBe('drift');
      expect(result.baseUrl).toBe('https://drift.neuraldeep.ru/v1');
    }

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer dft_test');
    expect(init.redirect).toBe('manual');
  });

  it('401 → unauthorized (ключ отклонён)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'bad key' }));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('unauthorized');
  });

  it('404 → нет OpenAI-совместимого API', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('models_not_found');
  });

  it('302 → редиректы не проходим', async () => {
    fetchMock.mockResolvedValue(jsonResponse(302, {}));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('redirect_blocked');
  });

  it('500 → server_error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(502, {}));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('server_error');
  });

  it('не-JSON ответ → bad_response', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('bad_response');
  });

  it('пустой список моделей → models_not_found', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('models_not_found');
  });

  it('abort → timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('timeout');
  });

  it('сетевая ошибка → unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await probeAgentEndpoint({ baseUrl: 'https://a.example.com/v1', apiKey: 'k' });
    expect(!result.ok && result.code).toBe('unreachable');
  });
});
