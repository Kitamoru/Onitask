// Тест на persistRunAttachments — вызов реального кода с подставным клиентом.
//
// Функция вынесена из index.ts именно ради этого: index.ts грузит esm.sh и в
// vitest не поднимается, поэтому проверка дедупа регуляркой по исходнику была
// бы ровно тем ложно-зелёным тестом, о котором AGENTS.md §5 (комментарий
// удовлетворяет toContain). Здесь файл реально «загружается» и «вставляется»,
// а утверждения — на результат.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  persistRunAttachments,
  resolveArtifactUrl,
} from '../../supabase/functions/agent-runtime/persistAttachments';

const TEXT = Buffer.from('привет, мир', 'utf8').toString('base64');

interface CallLog {
  uploads: string[];
  inserts: string[];
  removed: string[];
}

/**
 * Подставной Supabase-клиент: считает вызовы и имитирует UNIQUE(execution_id,
 * filename) — повторная вставка того же имени даёт ошибку, как в БД.
 */
function makeClient(opts: { existing?: string[] } = {}): {
  client: unknown;
  log: CallLog;
} {
  const log: CallLog = { uploads: [], inserts: [], removed: [] };
  const stored = new Set(opts.existing ?? []);

  const storage = {
    from: () => ({
      upload: async (path: string) => {
        log.uploads.push(path);
        return { error: null };
      },
      remove: async (paths: string[]) => {
        log.removed.push(...paths);
        return { error: null };
      },
    }),
  };

  const client = {
    storage,
    from: (table: string) => {
      if (table !== 'task_attachments') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: async () => ({
            data: [...stored].map((filename) => ({ filename })),
            error: null,
          }),
        }),
        insert: async (row: { filename: string }) => {
          if (stored.has(row.filename)) {
            return { error: { message: 'duplicate key value violates unique constraint "uniq_exec_filename"' } };
          }
          stored.add(row.filename);
          log.inserts.push(row.filename);
          return { error: null };
        },
      };
    },
  };

  return { client, log };
}

const baseOpts = {
  workspaceId: 'ws-1',
  taskId: 'task-1',
  executionId: 'exec-1',
  // Забор файла живёт по этим двум полям. В тестах на content_base64 fetch не
  // вызывается, но значения должны быть настоящими, иначе тест врал бы.
  baseUrl: 'https://drift.neuraldeep.ru/v1',
  apiKey: 'test-key',
};

// Тесты mintUploadTarget удалены вместе с функцией (ONIT-43, 2026-09-28).
// Кейс оказался не в формате URL: Drift получил исправный signedUrl, вернул
// правильный storage_path и отчитался «Файл успешно загружен в Storage» —
// объекта в бакете не было. Модель не умеет заливать по HTTP и предпочла это
// фолбэку, который сработал бы. Защита теперь на стороне промта: канал один,
// тело ответа, и его проверяет agentRuntimeProvider.test.ts.

describe('persistRunAttachments: дедуп по имени файла', () => {
  it('файл один раз попадает в Storage и в манифест', async () => {
    const { client, log } = makeClient();
    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'otchet.txt', content_base64: TEXT }],
    });

    expect(result.manifest).toHaveLength(1);
    expect(result.manifest[0].filename).toBe('otchet.txt');
    expect(result.failed).toEqual([]);
    expect(log.uploads).toHaveLength(1);
    expect(log.inserts).toEqual(['otchet.txt']);
  });

  it('два одинаковых имени в одной пачке не дают второй вставки', async () => {
    // Регресс: `already` собирался из БД один раз и внутрь цикла не
    // пополнялся. Второй элемент с тем же именем ловил UNIQUE и попадал в
    // `failed` с причиной, которая читалась как ошибка загрузки файла.
    const { client, log } = makeClient();
    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [
        { filename: 'otchet.txt', content_base64: TEXT },
        { filename: 'otchet.txt', content_base64: TEXT },
      ],
    });

    expect(result.manifest).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(log.uploads).toHaveLength(1);
    expect(log.inserts).toEqual(['otchet.txt']);
  });

  it('имя, уже загруженное прошлой попыткой, пропускается', async () => {
    const { client, log } = makeClient({ existing: ['otchet.txt'] });
    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'otchet.txt', content_base64: TEXT }],
    });

    expect(result.manifest).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(log.uploads).toEqual([]);
  });

  it('ошибка вставки откатывает объект из Storage', async () => {
    // Стерно-тест на откат: без remove() в Storage остаётся сирота.
    const log: CallLog = { uploads: [], inserts: [], removed: [] };
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            log.uploads.push(path);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            log.removed.push(...paths);
            return { error: null };
          },
        }),
      },
      from: () => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: async () => ({ error: { message: 'boom' } }),
      }),
    };

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'otchet.txt', content_base64: TEXT }],
    });

    expect(result.manifest).toEqual([]);
    expect(result.failed).toEqual([{ filename: 'otchet.txt', reason: 'boom' }]);
    expect(log.removed).toEqual(log.uploads);
  });

  it('пустой raw не ходит в базу вовсе', async () => {
    const { client, log } = makeClient();
    const result = await persistRunAttachments(client, { ...baseOpts, raw: undefined });
    expect(result).toEqual({ manifest: [], rejected: [], failed: [] });
    expect(log.uploads).toEqual([]);
  });
});

// ============================================================================
// Забор файла по source_path (ONIT-43, шаг 3)
// ============================================================================

const CSV_BYTES = Buffer.from('probe,1\n', 'utf8');
const CSV_MIME = 'text/csv';

/** Ответ fetch, которого ждёт fetchArtifactBytes. */
function artifactResponse(status: number, body?: Buffer): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => (body ?? Buffer.alloc(0)),
  } as unknown as Response;
}

describe('resolveArtifactUrl: хост берётся только из коннектора', () => {
  const BASE = 'https://drift.neuraldeep.ru/v1';

  it('собирает <base>/files/<путь>', () => {
    expect(resolveArtifactUrl(BASE, 'otchet/presidents_usa.xlsx')?.toString()).toBe(
      'https://drift.neuraldeep.ru/v1/files/otchet/presidents_usa.xlsx',
    );
  });

  it('кодирует сегменты пути', () => {
    expect(resolveArtifactUrl(BASE, 'отчёт 1.csv')?.toString()).toBe(
      'https://drift.neuraldeep.ru/v1/files/%D0%BE%D1%82%D1%87%D1%91%D1%82%201.csv',
    );
  });

  // Каждый следующий пункт — попытка увести запрос с хоста коннектора.
  it.each([
    ['traversal', '../../etc/passwd'],
    ['абсолютный путь', '/etc/passwd'],
    ['чужая схема', 'http://evil.example/x.csv'],
    ['протокол-относительный', '//evil.example/x.csv'],
    ['пусто', ''],
  ])('отклоняет %s', (_label, path) => {
    expect(resolveArtifactUrl(BASE, path)).toBeNull();
  });

  it('не доверяет не-https base_url коннектора', () => {
    expect(resolveArtifactUrl('http://drift.neuraldeep.ru/v1', 'x.csv')).toBeNull();
  });

  it('не доверяет мусорному base_url', () => {
    expect(resolveArtifactUrl('не url', 'x.csv')).toBeNull();
  });
});

describe('persistRunAttachments: забор по source_path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('скачивает файл, кладёт в Storage и пишет манифест', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return artifactResponse(200, CSV_BYTES);
    });
    const { client, log } = makeClient();

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'presidents_usa.csv', source_path: 'out/presidents_usa.csv' }],
    });

    expect(seen).toEqual(['https://drift.neuraldeep.ru/v1/files/out/presidents_usa.csv']);
    expect(result.manifest).toHaveLength(1);
    expect(result.manifest[0]).toMatchObject({ filename: 'presidents_usa.csv', mime_type: CSV_MIME });
    expect(result.failed).toEqual([]);
    // Байты реально доехали до Storage, а не «записались в манифест».
    expect(log.uploads).toHaveLength(1);
    expect(log.inserts).toEqual(['presidents_usa.csv']);
  });

  it('файл больше потолка ответа проходит — размер не измеряем в токенах', async () => {
    const big = Buffer.alloc(700 * 1024, 0x41); // 700 КБ: base64 в 8k токенов не влез бы
    vi.stubGlobal('fetch', async () => artifactResponse(200, big));
    const { client, log } = makeClient();

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'big.csv', source_path: 'big.csv' }],
    });

    expect(result.failed).toEqual([]);
    expect(log.uploads).toHaveLength(1);
  });

  it('404 → failed с причиной, в манифест ничего не попадает', async () => {
    vi.stubGlobal('fetch', async () => artifactResponse(404));
    const { client, log } = makeClient();

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'otchet.csv', source_path: 'otchet.csv' }],
    });

    expect(result.manifest).toEqual([]);
    expect(result.failed[0].reason).toMatch(/HTTP 404/);
    expect(log.uploads).toEqual([]);
  });

  it('файл больше 2 МБ отбрасывается до загрузки', async () => {
    vi.stubGlobal('fetch', async () => artifactResponse(200, Buffer.alloc(3 * 1024 * 1024, 0x41)));
    const { client, log } = makeClient();

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'huge.csv', source_path: 'huge.csv' }],
    });

    expect(result.failed[0].reason).toMatch(/2MB/);
    expect(log.uploads).toEqual([]);
  });

  it('содержимое не совпало с расширением — файл отбрасывается', async () => {
    // Переименованный исполняемый файл под видом .png: магия байтов обязана его
    // поймать, иначе в Telegram уйдёт битый файл с доверенным именем.
    const fakePng = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64, 0)]);
    vi.stubGlobal('fetch', async () => artifactResponse(200, fakePng));
    const { client, log } = makeClient();

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'chart.png', source_path: 'chart.png' }],
    });

    expect(result.failed[0].reason).toMatch(/does not match declared type/);
    expect(log.uploads).toEqual([]);
  });

  it('пустой ответ — отказ, а не файл нулевого размера', async () => {
    vi.stubGlobal('fetch', async () => artifactResponse(200, Buffer.alloc(0)));
    const { client, log } = makeClient();

    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'empty.csv', source_path: 'empty.csv' }],
    });

    expect(result.failed[0].reason).toMatch(/empty/);
    expect(log.uploads).toEqual([]);
  });

  it('путь, ведущий не на хост коннектора, не фетчится вовсе', async () => {
    let called = false;
    vi.stubGlobal('fetch', async () => {
      called = true;
      return artifactResponse(200, CSV_BYTES);
    });
    const { client } = makeClient();

    // Такой элемент reviewAttachments уже отбросит, но если бы пробрался —
    // resolveArtifactUrl обязан вернуть null, а не увести запрос.
    const result = await persistRunAttachments(client, {
      ...baseOpts,
      raw: [{ filename: 'x.csv', source_path: '../../secret' }],
    });

    expect(called).toBe(false);
    expect(result.manifest).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/relative workspace path/);
  });
});
