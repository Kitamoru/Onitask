// Тест на persistRunAttachments — вызов реального кода с подставным клиентом.
//
// Функция вынесена из index.ts именно ради этого: index.ts грузит esm.sh и в
// vitest не поднимается, поэтому проверка дедупа регуляркой по исходнику была
// бы ровно тем ложно-зелёным тестом, о котором AGENTS.md §5 (комментарий
// удовлетворяет toContain). Здесь файл реально «загружается» и «вставляется»,
// а утверждения — на результат.
import { describe, it, expect } from 'vitest';
import { persistRunAttachments } from '../../supabase/functions/agent-runtime/persistAttachments';

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
};

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
