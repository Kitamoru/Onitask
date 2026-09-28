// Тест на persistRunAttachments — вызов реального кода с подставным клиентом.
//
// Функция вынесена из index.ts именно ради этого: index.ts грузит esm.sh и в
// vitest не поднимается, поэтому проверка дедупа регуляркой по исходнику была
// бы ровно тем ложно-зелёным тестом, о котором AGENTS.md §5 (комментарий
// удовлетворяет toContain). Здесь файл реально «загружается» и «вставляется»,
// а утверждения — на результат.
import { describe, it, expect } from 'vitest';
import { persistRunAttachments, mintUploadTarget } from '../../supabase/functions/agent-runtime/persistAttachments';

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

// Регресс ONIT-43: URL собирался вручную как
// `/storage/v1/object/upload/<bucket>/<path>`, Storage читал сегмент `upload`
// как имя бакета и отвечал «bucket not found». Агент честно отступал по
// инструкции «не смог загрузить — верни пустой массив», и файл терялся.
describe('mintUploadTarget (ONIT-43)', () => {
  const clientWith = (data: unknown, error: unknown = null) =>
    ({
      storage: {
        from: () => ({ createSignedUploadUrl: async () => ({ data, error }) }),
      },
    }) as never;

  const ids = { workspaceId: 'ws-1', taskId: 'task-1', executionId: 'exec-1' };

  it('отдаёт ровно тот signedUrl, который вернул API', async () => {
    // Ключевое утверждение: URL НЕ собирается вручную. Любая ручная склейка
    // — это копирование детали API, которую меняет обновление Supabase.
    const signedUrl =
      'https://proj.supabase.co/storage/v1/object/upload/sign/task-attachments/ws-1/task-1/exec-1?token=abc';
    const target = await mintUploadTarget(clientWith({ signedUrl, token: 'abc' }), ids);

    expect(target).toEqual({ storagePath: 'ws-1/task-1/exec-1', url: signedUrl });
    expect(target?.url).toBe(signedUrl);
  });

  it('подписывается ровно тот путь, который агент вернёт в storage_path', async () => {
    // Инвариант: агент берёт storage_path из блока ЗАГРУЗКА, значит подписанный
    // путь и возвращаемый в промт обязаны совпадать. Иначе манифест укажет
    // на объект, которого нет, и файл молча потеряется.
    const signedPaths: string[] = [];
    const client = {
      storage: {
        from: () => ({
          createSignedUploadUrl: async (path: string) => {
            signedPaths.push(path);
            return { data: { signedUrl: `https://p/${path}?token=t`, token: 't' }, error: null };
          },
        }),
      },
    } as never;

    const target = await mintUploadTarget(client, ids);

    expect(signedPaths).toEqual(['ws-1/task-1/exec-1']);
    expect(target?.storagePath).toBe(signedPaths[0]);
    expect(target?.url).toContain(signedPaths[0]);
  });

  it('ошибка подписи → null, а не ссылка в никуда', async () => {
    const target = await mintUploadTarget(clientWith(null, { message: 'no access' }), ids);
    expect(target).toBeNull();
  });

  it('ответ без signedUrl → null', async () => {
    // Раньше проверяли token и склеивали URL сами. Если API вернёт иное
    // поле, мы обязаны упасть в base64-фолбэк, а не выдать битую ссылку.
    const target = await mintUploadTarget(clientWith({ token: 'abc' }), ids);
    expect(target).toBeNull();
  });
});

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
