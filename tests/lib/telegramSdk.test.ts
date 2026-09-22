// Tests for src/lib/telegramSdk.ts — SDK wait + start_param parsing.
// Regression: PERF-03 (SDK afterInteractive) broke Telegram deep links —
// TelegramDeepLinkRouter read window.Telegram synchronously on mount and
// silently died, so «Открыть в приложении» just landed on the plain flowboard.
import { describe, it, expect, afterEach } from 'vitest';
import {
  waitForTelegramWebApp,
  parseTaskStartParam,
  flowboardQueryFromStartParam,
} from '../../src/lib/telegramSdk';

describe('parseTaskStartParam', () => {
  it('task_ONI-42 → fullId + вкладка «Общее»', () => {
    expect(parseTaskStartParam('task_ONI-42')).toEqual({
      fullId: 'ONI-42',
      tab: 'general',
    });
  });

  it('task_ONI-42_comments → fullId + вкладка «Комментарии» (FILE-03)', () => {
    expect(parseTaskStartParam('task_ONI-42_comments')).toEqual({
      fullId: 'ONI-42',
      tab: 'comments',
    });
  });

  it('регистр префикса не важен, номер нормализуется как есть', () => {
    expect(parseTaskStartParam('task_boop-39')).toEqual({
      fullId: 'boop-39',
      tab: 'general',
    });
  });

  it('perf-режим (PERF-06) не является задачей', () => {
    expect(parseTaskStartParam('perf')).toBeNull();
  });

  it('referral-код (WS-06) не является задачей', () => {
    expect(parseTaskStartParam('ws_INVITE_CODE')).toBeNull();
  });

  it('мусор / пустота / отсутствие start_param → null', () => {
    expect(parseTaskStartParam('')).toBeNull();
    expect(parseTaskStartParam(undefined)).toBeNull();
    expect(parseTaskStartParam(null)).toBeNull();
    expect(parseTaskStartParam('task_')).toBeNull();
    expect(parseTaskStartParam('task_ONI-42_extra')).toBeNull();
    expect(parseTaskStartParam('тask_ONI-42')).toBeNull(); // кириллическая «т»
  });
});

describe('flowboardQueryFromStartParam', () => {
  it('задача → /flowboard?open_task=<fullId>', () => {
    expect(flowboardQueryFromStartParam('task_ONI-42')).toBe(
      '/flowboard?open_task=ONI-42',
    );
  });

  it('задача + comments → /flowboard?open_task=<fullId>&tab=comments', () => {
    expect(flowboardQueryFromStartParam('task_ONI-42_comments')).toBe(
      '/flowboard?open_task=ONI-42&tab=comments',
    );
  });

  it('flow_<handle> → /workspace/<handle> (§6.2d, задел на будущее)', () => {
    expect(flowboardQueryFromStartParam('flow_acme')).toBe('/workspace/acme');
  });

  it('неизвестный start_param → null', () => {
    expect(flowboardQueryFromStartParam('perf')).toBeNull();
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

  it('таймаут → null (не висим вечно, boot продолжает ошибку sdk_unavailable)', async () => {
    (globalThis as any).window = {};
    expect(await waitForTelegramWebApp(100)).toBeNull();
  });
});
