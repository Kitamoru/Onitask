// Тесты паритета двух реализаций правил файлов (FILE-01 / DS-10):
//   канон  — lib/shared/attachments.ts (MCP + TWA, «упал на первом плохом»)
//   копия  — supabase/functions/agent-runtime/attachments.ts (hosted, «отбросил
//            плохой, остальные прошли»)
// Дублирование осознанное (edge-функция деплоится каталогом и lib/ не видит),
// поэтому цель теста — ловить семантический дрейф: не только равенство
// констант, но и совпадение решений на одних и тех же входах. Плюс явно
// зафиксированы два известных расхождения (см. блок «известные расхождения»).
import { describe, it, expect } from 'vitest';
import * as lib from '../../lib/shared/attachments';
import * as rt from '../../supabase/functions/agent-runtime/attachments';

const asciiB64 = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64');
const bytesB64 = (bytes: number[]) =>
  Buffer.from(Uint8Array.from(bytes)).toString('base64');

// Положительные образцы магии для каждого расширения whitelist.
const PNG = bytesB64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = bytesB64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = asciiB64('GIF89a....');
const WEBP = asciiB64('RIFF\x00\x00\x00\x00WEBP');
const PDF = asciiB64('%PDF-1.7\nstream');
const OLE2 = bytesB64([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = asciiB64('PK\x03\x04rest');
const TEXT = asciiB64('привет, мир');
const OGG = asciiB64('OggS\x00\x02....');
const MP3 = asciiB64('ID3\x04\x00\x00....');

/** PNG-магия кратно 3 байтам — base64 без padding (нужно для склейки строк). */
const PNG_ALIGNED = bytesB64([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

const SAMPLE_BY_MIME: Record<string, string> = {
  'image/png': PNG,
  'image/jpeg': JPEG,
  'image/webp': WEBP,
  'image/gif': GIF,
  'application/pdf': PDF,
  'application/msword': OLE2,
  'application/vnd.ms-excel': OLE2,
  'application/vnd.ms-powerpoint': OLE2,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ZIP,
  'application/zip': ZIP,
  'text/csv': TEXT,
  'text/plain': TEXT,
  'text/markdown': TEXT,
  'audio/ogg': OGG,
  'audio/mpeg': MP3,
};

/** Переименованный шелл-скрипт: расширение png, магия не сходится. */
const FAKE_PNG = asciiB64('#!/bin/sh\nrm -rf /');

/**
 * Инвариант паритета: копия принимает ровно те элементы, что канон пропускает
 * поштучно (проверкой `[item]`), в том же порядке (с учётом лимита в 5), и
 * отклоняет остальные — под тем же именем (или меткой «#N», если имени нет).
 */
function expectDecisionParity(raw: unknown[]) {
  const review = rt.reviewAttachments(raw);
  const items = Array.isArray(raw) ? raw : [];
  const sanitize = (item: unknown) =>
    rt.sanitizeFilename(String((item as { filename?: unknown })?.filename ?? ''));

  const validPerItem = items.map((item) => {
    try {
      lib.validateAttachments([item]);
      return true;
    } catch {
      return false;
    }
  });

  const expectedAccepted: string[] = [];
  const expectedRejected: string[] = [];
  items.forEach((item, index) => {
    const name = sanitize(item) || `#${index + 1}`;
    if (
      validPerItem[index] &&
      expectedAccepted.length < lib.MAX_ATTACHMENTS_PER_TASK
    ) {
      expectedAccepted.push(name);
    } else {
      expectedRejected.push(name);
    }
  });

  expect(review.accepted.map((a) => a.filename)).toEqual(expectedAccepted);
  expect(review.rejected.map((r) => r.filename)).toEqual(expectedRejected);
  return review;
}

describe('attachments: паритет констант и чистых хелперов', () => {
  it('лимиты совпадают по значениям, а не по именам', () => {
    expect(rt.MAX_ATTACHMENTS).toBe(lib.MAX_ATTACHMENTS_PER_TASK);
    expect(rt.MAX_ONE_BASE64_LENGTH).toBe(lib.MAX_ONE_BASE64_BYTES);
    expect(rt.MAX_TOTAL_BASE64_LENGTH).toBe(lib.MAX_TOTAL_BASE64_BYTES);
    expect(rt.MAX_FILENAME_LENGTH).toBe(lib.MAX_FILENAME_LENGTH);
  });

  it('whitelist и карта mime совпадают', () => {
    expect([...rt.ALLOWED_EXTENSIONS].sort()).toEqual(
      [...lib.ALLOWED_ATTACHMENT_EXTENSIONS].sort(),
    );
    expect(rt.EXTENSION_MIME).toEqual(lib.EXTENSION_MIME);
    // 18 расширений (решение владельца, раздел 3) — страховка от «тихого» сужения
    expect(Object.keys(rt.EXTENSION_MIME)).toHaveLength(18);
  });

  it('extensionOf / sanitizeFilename одинаковы на грязных именах', () => {
    const names = [
      'chart.png',
      'CHART.PNG',
      'archive.tar.gz',
      'noext',
      'trailing.',
      '.hidden',
      'C:\\Users\\me\\docs\\report.pdf',
      'dir/sub/report.pdf',
      '../../etc/passwd.png',
      'x'.repeat(200) + '.txt',
      '',
    ];
    for (const name of names) {
      expect(rt.extensionOf(name)).toBe(lib.extensionOf(name));
      expect(rt.sanitizeFilename(name)).toBe(lib.sanitizeAttachmentFilename(name));
    }
  });

  it('base64ToBytes совпадает на валидном base64', () => {
    for (const sample of [PNG, JPEG, PDF, TEXT, OGG, MP3, asciiB64('')]) {
      expect([...rt.base64ToBytes(sample)]).toEqual([
        ...lib.base64ToBytes(sample),
      ]);
    }
  });

  it('sniffMatches совпадает на всём корпусе байтов и принимает свой тип', () => {
    const corpus: number[][] = [
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0xff, 0xd8, 0xff, 0xe0],
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
      [0, 1, 2, 3],
      [],
    ];
    for (const [, mime] of Object.entries(rt.EXTENSION_MIME)) {
      expect(SAMPLE_BY_MIME[mime]).toBeTruthy(); // страховка от «порчи корпуса»
      const positive = rt.base64ToBytes(SAMPLE_BY_MIME[mime]);
      expect(rt.sniffMatches(mime, positive)).toBe(true);
      expect(lib.sniffMatches(mime, positive)).toBe(true);
      for (const raw of [
        ...corpus.map((b) => Uint8Array.from(b)),
        positive,
        lib.base64ToBytes(TEXT),
        lib.base64ToBytes(asciiB64('x\x00y')),
      ]) {
        expect(rt.sniffMatches(mime, raw)).toBe(lib.sniffMatches(mime, raw));
      }
    }
  });
});

describe('attachments: паритет решений на одинаковых пачках', () => {
  const good = { filename: 'chart.png', content_base64: PNG, caption: 'график' };
  const goodPdf = { filename: 'report.pdf', content_base64: PDF };
  const upper = { filename: 'CHART.PNG', content_base64: PNG };
  const text = { filename: 'notes.txt', content_base64: TEXT };
  const badMagic = { filename: 'script.png', content_base64: FAKE_PNG };
  const badExt = { filename: 'report.exe', content_base64: TEXT };
  const badName = { filename: '../../etc/passwd.png', content_base64: PNG };
  const noContent = { filename: 'chart.png', content_base64: '' };
  const noName = { filename: '', content_base64: PNG };
  const notObject = 'chart.png';
  const jpegAsPng = { filename: 'photo.png', content_base64: JPEG };

  it('валидные пачки: копия ничего не отклоняет и сохраняет caption', () => {
    expect(expectDecisionParity([]).accepted).toEqual([]);

    const review = expectDecisionParity([good, goodPdf, upper, text]);
    expect(review.rejected).toEqual([]);
    expect(review.accepted).toHaveLength(4);
    expect(review.accepted[0].caption).toBe('график');
    expect(review.accepted[1].caption).toBeUndefined();
  });

  it('плохой элемент — отклонён тот же, что уронил канон', () => {
    for (const raw of [
      [badMagic],
      [badExt],
      [badName],
      [noContent],
      [noName],
      [notObject],
      [jpegAsPng],
      [good, badMagic],
      [good, goodPdf, badExt],
      [good, noContent, text],
    ]) {
      expectDecisionParity(raw);
    }
  });

  it('лимит одного файла (>2MB base64) отклоняют оба', () => {
    const oversized = {
      filename: 'big.txt',
      content_base64: 'A'.repeat(lib.MAX_ONE_BASE64_BYTES + 1),
    };
    expect(() => lib.validateAttachments([oversized])).toThrow(/too large/);
    expectDecisionParity([oversized]);
  });

  it('суммарный лимит (>3MB base64): третий файл отброшен, первые два прошли', () => {
    // PNG-магия без padding, чтобы склейка строк осталась валидным base64
    const chunk = (name: string) => ({
      filename: name,
      content_base64: PNG_ALIGNED + 'A'.repeat(1_100_000),
    });
    expectDecisionParity([chunk('a.png')]); // поштучно файл валиден в обоих

    const batch = [chunk('a.png'), chunk('b.png'), chunk('c.png')];
    expect(() => lib.validateAttachments(batch)).toThrow(
      /total attachments size/,
    );

    const review = rt.reviewAttachments(batch);
    expect(review.accepted.map((a) => a.filename)).toEqual(['a.png', 'b.png']);
    expect(review.rejected.map((r) => r.filename)).toEqual(['c.png']);
  });

  it('невалидный base64 для бинарного типа отклоняют оба', () => {
    expectDecisionParity([{ filename: 'chart.png', content_base64: '!!!' }]);
  });
});

describe('attachments: известные расхождения (не регрессия)', () => {
  it('>5 файлов: канон падает целиком, копия принимает первые пять', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      filename: `f${i}.png`,
      content_base64: PNG,
    }));
    expect(() => lib.validateAttachments(six)).toThrow(/at most 5/);

    const review = rt.reviewAttachments(six);
    expect(review.accepted.map((a) => a.filename)).toEqual([
      'f0.png',
      'f1.png',
      'f2.png',
      'f3.png',
      'f4.png',
    ]);
    expect(review.rejected).toEqual([
      { filename: 'f5.png', reason: 'more than 5 files' },
    ]);
  });

  it('не-массив: канон падает, копия отдаёт отказ с меткой «—»', () => {
    expect(() => lib.validateAttachments({ nope: true })).toThrow(
      /must be an array/,
    );
    expect(rt.reviewAttachments({ nope: true })).toEqual({
      accepted: [],
      rejected: [{ filename: '—', reason: 'attachments must be an array' }],
    });
  });

  it('мусорный base64 в text/*: копия отбрасывает, канон пропускает (дыра lib)', () => {
    // Buffer.from(…, 'base64') терпим к мусору и даёт 0 байт; atob бросает.
    // Для text/* пустой файл проходит sniffMatches в lib → пустой файл уезжает
    // в Storage. Копия это ловит («invalid base64» / «decoded file is empty»).
    // Когда закроем дыру в lib (guard на bytes.length === 0) — обновить тест
    // вместе с кодом: расхождение зафиксировано осознанно.
    expect([...lib.base64ToBytes('!!!')]).toEqual([]);
    expect(() => rt.base64ToBytes('!!!')).toThrow();
    expect(
      lib.validateAttachments([{ filename: 'note.txt', content_base64: '!!!' }]),
    ).toHaveLength(1);
    expect(
      rt.reviewAttachments([{ filename: 'note.txt', content_base64: '!!!' }]),
    ).toEqual({
      accepted: [],
      rejected: [{ filename: 'note.txt', reason: 'invalid base64' }],
    });
  });
});
