// Tests for src/lib/telegramSdk.ts — SDK wait + start_param parsing.
// Regression: PERF-03 (SDK afterInteractive) broke Telegram deep links —
// TelegramDeepLinkRouter read window.Telegram synchronously on mount and
// silently died, so «Открыть в приложении» just landed on the plain flowboard.
import { describe, it, expect, afterEach } from 'vitest';
import { waitForTelegramWebApp, shouldUseCachedInit } from '../../src/lib/telegramSdk';
import { inviteDeepLink, parseStartParam } from '../../src/lib/taskLaunch';

describe('shouldUseCachedInit', () => {
  it('обычный запуск использует cache', () => {
    expect(shouldUseCachedInit('', true)).toBe(true);
  });

  it('invite/deep link всегда обходит cache', () => {
    expect(shouldUseCachedInit('invite-code', true)).toBe(false);
  });

  it('force refresh обходит cache', () => {
    expect(shouldUseCachedInit('', false)).toBe(false);
  });
});

describe('parseStartParam', () => {
  it('task_ONI-42 → fullId + вкладка «Общее»', () => {
    expect(parseStartParam('task_ONI-42')).toEqual({ kind: 'task', fullId: 'ONI-42', tab: 'general' });
  });

  it('task_ONI-42_comments → fullId + вкладка «Комментарии»', () => {
    expect(parseStartParam('task_ONI-42_comments')).toEqual({ kind: 'task', fullId: 'ONI-42', tab: 'comments' });
  });

  it('flow_acme → flow target', () => {
    expect(parseStartParam('flow_acme')).toEqual({ kind: 'flow', slug: 'acme' });
  });

  it('builds namespaced invite links and keeps base configurable', () => {
    expect(inviteDeepLink('abc123')).toBe(
      'https://t.me/onitaskbot/onitask?startapp=invite_abc123',
    );
    expect(inviteDeepLink('abc123', 'https://example.test/app')).toBe(
      'https://example.test/app?startapp=invite_abc123',
    );
  });

  it('accepts legacy invite code and namespaced invite code identically', () => {
    expect(parseStartParam('abc123')).toEqual({ kind: 'invite', code: 'abc123' });
    expect(parseStartParam('invite_abc123')).toEqual({ kind: 'invite', code: 'abc123' });
  });

  it('reserved namespaces и мусор не становятся invite', () => {
    expect(parseStartParam('task_ONI-42_extra')).toBeNull();
    expect(parseStartParam('тask_ONI-42')).toBeNull();
    expect(parseStartParam('')).toBeNull();
    expect(parseStartParam(undefined)).toBeNull();
  });
});

describe('waitForTelegramWebApp', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete globalThis.window;
  });

  it('window нет (SSR/node) → null без ожидания', async () => {
    expect(await waitForTelegramWebApp()).toBeNull();
  });

  it('SDK уже загружен → возвращает WebApp сразу', async () => {
    const tg = { ready: () => {}, initData: 'x' };
    (globalThis as any).window = { Telegram: { WebApp: tg } };
    expect(await waitForTelegramWebApp(100)).toBe(tg);
  });

  it('SDK появляется позже → поллинг дожидается', async () => {
    (globalThis as any).window = {};
    const tg = { ready: () => {}, initData: 'x' };
    setTimeout(() => {
      (globalThis as any).window = { Telegram: { WebApp: tg } };
    }, 80);
    expect(await waitForTelegramWebApp(1000)).toBe(tg);
  });

  it('медленный CDN SDK (> прежнего таймаута 1.5с) → boot дожидается', async () => {
    (globalThis as any).window = {};
    const tg = { ready: () => {}, initData: 'x' };
    setTimeout(() => {
      (globalThis as any).window = { Telegram: { WebApp: tg } };
    }, 1650);
    expect(await waitForTelegramWebApp()).toBe(tg);
  });

  it('таймаут → null (не висим вечно, boot продолжает ошибку sdk_unavailable)', async () => {
    (globalThis as any).window = {};
    expect(await waitForTelegramWebApp(100)).toBeNull();
  });
});
