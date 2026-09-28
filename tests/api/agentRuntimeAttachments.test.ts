// Tests for supabase/functions/agent-runtime/attachments.ts — pure validation.
// Паритет с lib/shared/attachments.ts (FILE-01): whitelist + магия байтов +
// лимиты. Проверяем, что невалидный файл отбрасывается с причиной, а не
// роняет прогон целиком.
import { describe, it, expect } from 'vitest';
import {
  reviewAttachments,
  MAX_ATTACHMENTS,
  MAX_ONE_BASE64_LENGTH,
} from '../../supabase/functions/agent-runtime/attachments';

const bytesB64 = (bytes: number[]) =>
  Buffer.from(Uint8Array.from(bytes)).toString('base64');

const asciiB64 = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64');

const PNG = bytesB64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF = asciiB64('%PDF-1.7\nstream');
const TXT = asciiB64('привет, мир');

describe('agent-runtime attachments: happy path', () => {
  it('нет attachments → пусто, без отказов', () => {
    expect(reviewAttachments(undefined)).toEqual({ accepted: [], rejected: [] });
    expect(reviewAttachments(null)).toEqual({ accepted: [], rejected: [] });
  });

  it('валидные файлы принимаются, caption сохраняется', () => {
    const review = reviewAttachments([
      { filename: 'chart.png', content_base64: PNG, caption: 'график' },
      { filename: 'report.pdf', content_base64: PDF },
      { filename: 'notes.txt', content_base64: TXT },
    ]);

    expect(review.rejected).toEqual([]);
    expect(review.accepted.map((a) => a.filename)).toEqual([
      'chart.png',
      'report.pdf',
      'notes.txt',
    ]);
    expect(review.accepted[0].caption).toBe('график');
    expect(review.accepted[1].caption).toBeUndefined();
  });

  it('не-массив → один отказ, не исключение', () => {
    const review = reviewAttachments('chart.png');
    expect(review.accepted).toEqual([]);
    expect(review.rejected).toHaveLength(1);
    expect(review.rejected[0].reason).toContain('must be an array');
  });
});

describe('agent-runtime attachments: файлы, залитые агентом (FILE-08)', () => {
  // Байты в Storage приходят по одноразовой ссылке, мимо модели. Путь в ответе
  // агента — тоже данные, к которым нельзя относиться доверчиво: description
  // задачи помечен как недоверенный, поэтому инъекция может подсунуть чужой
  // путь. Отсюда обязательная проверка префикса воркспейса.
  const WS = 'ws-11111111-2222-3333-4444-555555555555/';
  const okPath = `${WS}task-1/exec-1`;

  it('storage_path внутри своего воркспейса принимается без base64', () => {
    const review = reviewAttachments(
      [{ filename: 'otchet.xlsx', storage_path: okPath }],
      { workspacePrefix: WS },
    );
    expect(review.rejected).toEqual([]);
    expect(review.accepted).toEqual([{ filename: 'otchet.xlsx', storage_path: okPath }]);
  });

  it('чужой воркспейс отбрасывается — иначе файл приклеился бы к чужой задаче', () => {
    const review = reviewAttachments(
      [{ filename: 'otchet.xlsx', storage_path: 'ws-CHUHOROJ/task-9/exec-9' }],
      { workspacePrefix: WS },
    );
    expect(review.accepted).toEqual([]);
    expect(review.rejected[0].reason).toBe('storage_path is outside the workspace prefix');
  });

  it('без известного префикса storage_path не принимается вовсе', () => {
    const review = reviewAttachments([{ filename: 'otchet.xlsx', storage_path: okPath }]);
    expect(review.accepted).toEqual([]);
    expect(review.rejected[0].reason).toBe('storage_path given but workspace prefix is unknown');
  });

  it('обход каталога внутри своего префикса всё равно режется', () => {
    const review = reviewAttachments(
      [{ filename: 'otchet.xlsx', storage_path: `${WS}task-1/../../ws-chuzhoy/x` }],
      { workspacePrefix: WS },
    );
    expect(review.accepted).toEqual([]);
    expect(review.rejected[0].reason).toBe('invalid storage_path');
  });

  it('base64-фолбэк продолжает работать: агент, который грузить не умеет', () => {
    const review = reviewAttachments(
      [{ filename: 'note.txt', content_base64: TXT }],
      { workspacePrefix: WS },
    );
    expect(review.rejected).toEqual([]);
    expect(review.accepted).toHaveLength(1);
    expect(review.accepted[0].content_base64).toBeTruthy();
  });

  it('storage_path не отменяет проверку расширения', () => {
    const review = reviewAttachments(
      [{ filename: 'payload.exe', storage_path: okPath }],
      { workspacePrefix: WS },
    );
    expect(review.accepted).toEqual([]);
    expect(review.rejected[0].reason).toBe('unsupported file type: exe');
  });
});

describe('agent-runtime attachments: отбраковка отдельного файла', () => {
  it('магия байтов: переименованный файл в .png не проходит', () => {
    const review = reviewAttachments([
      { filename: 'evil.png', content_base64: asciiB64('MZ\x90\x00 executable') },
    ]);
    expect(review.accepted).toEqual([]);
    expect(review.rejected[0]).toEqual({
      filename: 'evil.png',
      reason: 'content does not match declared type: png',
    });
  });

  it('расширение вне whitelist', () => {
    const review = reviewAttachments([
      { filename: 'script.svg', content_base64: asciiB64('<svg/>') },
    ]);
    expect(review.rejected[0].reason).toBe('unsupported file type: svg');
  });

  it('path-traversal в имени', () => {
    const review = reviewAttachments([
      { filename: '../../etc/passwd', content_base64: PDF },
    ]);
    expect(review.rejected[0].reason).toBe('invalid filename');
  });

  it('пустой content_base64 и NUL в текстовом файле', () => {
    const review = reviewAttachments([
      { filename: 'empty.txt', content_base64: '   ' },
      { filename: 'binary.txt', content_base64: bytesB64([0x61, 0x00, 0x62]) },
    ]);
    expect(review.rejected.map((r) => r.reason)).toEqual([
      'neither content_base64 nor storage_path',
      'content does not match declared type: txt',
    ]);
  });

  it(`файл больше 2MB (base64) отбрасывается`, () => {
    const review = reviewAttachments([
      { filename: 'big.txt', content_base64: 'A'.repeat(MAX_ONE_BASE64_LENGTH + 4) },
    ]);
    expect(review.rejected[0]).toEqual({
      filename: 'big.txt',
      reason: 'file too large (base64 > 2MB)',
    });
  });

  it(`больше ${MAX_ATTACHMENTS} файлов — лишние отбрасываются`, () => {
    const raw = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => ({
      filename: `file${i}.txt`,
      content_base64: TXT,
    }));
    const review = reviewAttachments(raw);
    expect(review.accepted).toHaveLength(MAX_ATTACHMENTS);
    expect(review.rejected.map((r) => r.reason)).toEqual([
      `more than ${MAX_ATTACHMENTS} files`,
      `more than ${MAX_ATTACHMENTS} files`,
    ]);
  });

  it('плохой элемент не мешает хорошему (частичный успех)', () => {
    const review = reviewAttachments([
      { filename: 'evil.png', content_base64: asciiB64('not a png') },
      { filename: 'good.pdf', content_base64: PDF },
    ]);
    expect(review.accepted.map((a) => a.filename)).toEqual(['good.pdf']);
    expect(review.rejected).toHaveLength(1);
  });
});
