import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  mintAttachmentDownloadToken,
  verifyAttachmentDownloadToken,
} from '../../lib/shared/downloadToken';

describe('downloadToken', () => {
  const TASK_ID = 'task-uuid-1';
  const ATT_ID = 'attachment-uuid-1';

  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-secret';
  });

  afterAll(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('mint → verify: валидный токен проходит для того же scope', () => {
    const token = mintAttachmentDownloadToken(TASK_ID, ATT_ID);
    expect(verifyAttachmentDownloadToken(token, TASK_ID, ATT_ID)).toBe(true);
  });

  it('подделанная подпись отвергается', () => {
    const token = mintAttachmentDownloadToken(TASK_ID, ATT_ID);
    const [exp] = token.split(':');
    const tampered = `${exp}:${'f'.repeat(64)}`;
    expect(verifyAttachmentDownloadToken(tampered, TASK_ID, ATT_ID)).toBe(false);
  });

  it('scope mismatch: токен другого attachmentId отвергается', () => {
    const token = mintAttachmentDownloadToken(TASK_ID, ATT_ID);
    expect(verifyAttachmentDownloadToken(token, TASK_ID, 'attachment-uuid-2')).toBe(false);
    expect(verifyAttachmentDownloadToken(token, 'task-uuid-2', ATT_ID)).toBe(false);
  });

  it('просроченный токен отвергается (TTL 5 мин)', () => {
    const token = mintAttachmentDownloadToken(TASK_ID, ATT_ID);
    // сдвигаем время вперёд на TTL + 1 сек
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 301_000);
    expect(verifyAttachmentDownloadToken(token, TASK_ID, ATT_ID)).toBe(false);
    vi.useRealTimers();
  });

  it('мусор/пустота отвергаются без исключений', () => {
    expect(verifyAttachmentDownloadToken(null, TASK_ID, ATT_ID)).toBe(false);
    expect(verifyAttachmentDownloadToken('', TASK_ID, ATT_ID)).toBe(false);
    expect(verifyAttachmentDownloadToken('garbage', TASK_ID, ATT_ID)).toBe(false);
    expect(verifyAttachmentDownloadToken('abc:def', TASK_ID, ATT_ID)).toBe(false);
  });

  it('без секретного окружения — токены не выдаются и не верифицируются', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const token = mintAttachmentDownloadToken(TASK_ID, ATT_ID);
    expect(verifyAttachmentDownloadToken(token, TASK_ID, ATT_ID)).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-secret';
  });
});
