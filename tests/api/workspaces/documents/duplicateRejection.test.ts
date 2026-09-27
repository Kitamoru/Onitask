/**
 * Отсечение дублей документов по содержимому (миграция 133).
 *
 * Контекст. `workspace_documents.checksum` вычислялся (SHA-256), но НИГДЕ не
 * читался: повторная загрузка того же файла создавала второй документ со
 * вторым набором чанков, то есть вторую копию векторов и дубль в выдаче
 * `match_doc_chunks`. Политика владельца — повторная загрузка идентичного
 * содержимого это ошибка, а не замена.
 *
 * Критерий — СОДЕРЖИМОЕ, а не имя: `DESIGN.md` и `design-copy.md` с
 * одинаковыми байтами должны отклоняться.
 *
 * Защита двухслойная, и это не паранойя: проверка в приложении не спасает от
 * гонки — два параллельных запроса оба увидят, что такого документа нет, и
 * оба вставят. Поэтому в БД есть unique index, а маршрут дополнительно
 * разбирает 23505, иначе гонка выглядела бы как молчаливая потеря файла.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const VALIDATION = { valid: true, user: { id: 42 } };

// Маршрут читает TELEGRAM_BOT_TOKEN и ключи Supabase в константах на уровне
// модуля, то есть ДО выполнения тела теста. Обычный beforeEach слишком поздний:
// токен оставался пустым, и POST выходил с ранним 500 server_configuration_error
// мимо всей логики дедупликации. vi.hoisted выполняется до импортов.
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});

vi.mock('@/lib/telegram/validate', () => ({
  validateTelegramInitData: vi.fn(async () => VALIDATION),
}));
// Маршрут импортирует `lib/supabase` относительным путём
// ('../../../../../../lib/supabase'). Мокать его ТЕМ ЖЕ относительным
// specifier'ом нельзя: vi.mock разрешает путь относительно ФАЙЛА ТЕСТА, а не
// импортируемого модуля, поэтому пути не совпадают и мок не срабатывал.
// Настоящий клиент уходил в сеть (`TypeError: fetch failed` → 500
// database_error) мимо всей логики дедупликации, и тесты висели до таймаута.
// `@core` → `lib`, значит `@core/supabase` — тот же модуль, мок по resolved id.
vi.mock('@core/supabase', () => ({ createServerClient: vi.fn() }));

import { POST } from '@/app/api/workspaces/[id]/documents/route';
import { createServerClient } from '@core/supabase';

const WS = 'ws-1';

function makeFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/markdown' });
}

function request(files: File[]): NextRequest {
  return {
    headers: { get: () => 'init-data' },
    formData: async () => ({ getAll: () => files }),
  } as unknown as NextRequest;
}

/** SHA-256 тех же байт, что посчитает продовый `computeChecksum`. */
async function sha256Of(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface DbOptions {
  existing?: { filename: string; checksum: string }[];
  insertError?: { code: string; message: string } | null;
}

function makeDb(opts: DbOptions = {}) {
  const storageUpload = vi.fn(async () => ({ error: null }));
  const storageRemove = vi.fn(async () => ({ error: null }));
  const result = () => ({ data: { id: 'doc-new', filename: 'new.md' }, error: opts.insertError ?? null });
  // Маршрут вставляет так: .insert(payload).select().single() — цепочку
  // возвращать обязательно, иначе `insert(...).select is not a function`.
  const docInsert = vi.fn(() => ({
    select: vi.fn(() => ({ single: vi.fn(async () => result()) })),
  }));
  // Маршрут пишет джоб так: .insert({...}).select().single() — цепочку
  // возвращать обязательно, иначе падает `insert(...).select is not a function`.
  const queueInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: 'job-1' }, error: null })),
    })),
  }));

  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.not = vi.fn(() => c);
    c.insert = vi.fn(() => c);
    c.single = vi.fn(async () => result);
    c.maybeSingle = vi.fn(async () => result);
    c.then = (fn: (v: unknown) => unknown) => Promise.resolve(fn(result));
    return c;
  };

  // Различаем ЧТЕНИЕ документов (нужно для проверки дублей) и ВСТАВКУ.
  const docSelect = vi.fn(() => chain({ data: opts.existing ?? [], error: null }));
  // Маршрут обращается к таблице и читает (проверка дублей), и пишет
  // (вставка документа) — это РАЗНЫЕ методы одного объекта, флагов не нужно.
  const docFrom = { select: docSelect, insert: docInsert };

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'profiles') return chain({ data: { id: 'p-1' }, error: null });
      if (table === 'workers') return chain({ data: { id: 'w-1', role: 'admin' }, error: null });
      if (table === 'workspace_settings') {
        return chain({ data: { doc_kb_config: { max_files: 20, max_total_bytes: 5_000_000 } }, error: null });
      }
      if (table === 'workspace_documents') return docFrom;

      if (table === 'enrichment_queue') return { insert: queueInsert };
      return {};
    }),
    storage: { from: vi.fn(() => ({ upload: storageUpload, remove: storageRemove })) },
  };

  return { db, storageUpload, storageRemove, docInsert, queueInsert, docSelect };
}

function installDb(opts: DbOptions = {}) {
  const made = makeDb(opts);
  vi.mocked(createServerClient).mockReturnValue(made.db as never);
  return made;
}

const params = { params: Promise.resolve({ id: WS }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('дубль по содержимому: отказ до записи в Storage', () => {
  it('отклоняет файл, который уже загружен', async () => {
    const body = 'identical content';
    const checksum = await sha256Of(body);
    const made = installDb({ existing: [{ filename: 'DESIGN.md', checksum }] });

    const res = await POST(request([makeFile('DESIGN.md', body)]), params);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('duplicate_document');
    expect(json.duplicate_of).toBe('DESIGN.md');
    // Главное: до Storage дело не дошло — дубль не плодит мусор на диске.
    expect(made.storageUpload).not.toHaveBeenCalled();
    expect(made.docInsert).not.toHaveBeenCalled();
  });

  it('отклоняет по содержимому, даже если имя другое', async () => {
    const body = 'same bytes, different name';
    const checksum = await sha256Of(body);
    const made = installDb({ existing: [{ filename: 'DESIGN.md', checksum }] });

    const res = await POST(request([makeFile('design-copy.md', body)]), params);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.duplicate_of).toBe('DESIGN.md');
    expect(json.message).toContain('design-copy.md');
    expect(made.storageUpload).not.toHaveBeenCalled();
  });

  it('отклоняет два одинаковых файла в одном запросе', async () => {
    const body = 'duplicated within one request';
    const made = installDb({ existing: [] });

    const res = await POST(
      request([makeFile('a.md', body), makeFile('b.md', body)]),
      params,
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('duplicate_document');
    // Отсекаем весь запрос, а не грузим второй файл молча.
    expect(made.storageUpload).not.toHaveBeenCalled();
  });

  it('пропускает разные файлы', async () => {
    const made = installDb({ existing: [] });

    const res = await POST(
      request([makeFile('a.md', 'first'), makeFile('b.md', 'second')]),
      params,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(made.storageUpload).toHaveBeenCalledTimes(2);
  });
});

describe('дубль: второй уровень, гонка', () => {
  it('23505 от вставки не превращается в молчаливую потерю файла', async () => {
    // Гонка: параллельный запрос вставил тот же документ между проверкой и
    // нашей вставкой. Проверка в приложении этого не видит.
    const body = 'raced content';
    const made = installDb({
      existing: [],
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const res = await POST(request([makeFile('race.md', body)]), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    // Файл попал в Storage, но раз дубль отклонён — обязан быть убран.
    expect(made.storageUpload).toHaveBeenCalled();
    expect(made.storageRemove).toHaveBeenCalled();
    // И в ответе это видно, а не исчезает как обычный успех.
    const rejected = json.data.documents.find((d: any) => d.rejected);
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe('duplicate_document');
  });
});
