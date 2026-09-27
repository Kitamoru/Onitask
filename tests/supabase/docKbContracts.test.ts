import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Контракты, нарушение которых НЕВИДИМО.
 *
 * Все проверки ниже относятся к ошибкам, которые не падают: RPC отвечает 200,
 * функция рапортует об успехе, UI показывает «Готово» — а данные при этом шум.
 *
 * 1) Единая модель эмбеддингов. До 2026-09-27 документы индексировались через
 *    `e5-large`, а запросы строились через `bge-m3`. `match_doc_chunks` сравнивал
 *    векторы РАЗНЫХ моделей: косинус бессмыслен, ошибка молчаливая. Обнаружить
 *    её можно было только по качеству выдачи, то есть в проде.
 * 2) Префиксы e5-large: `passage:` при записи вектора, `query:` при поиске.
 *    Перепутаны — тот же молчаливый шум.
 * 3) Хеш содержимого задачи обязан совпадать в `task-embed` и `enrich-task`:
 *    иначе cache-hit в F-03 перестаёт срабатывать и каждая задача
 *    переэмбеживается заново при каждом обогащении.
 * 4) Словарь статусов документа в UI обязан совпадать с CHECK-констрейнтом БД.
 *    Было: TS-union содержал 'completed', в БД допустимо 'ready' — успешный
 *    документ не попадал ни в одну ветку отрисовки.
 */

const ROOT = process.cwd();
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const EMBEDDING_MODEL = 'e5-large';
const PASSAGE_PREFIX = 'passage: ';
const QUERY_PREFIX = 'query: ';

describe('Контракт модели эмбеддингов', () => {
  const files = {
    'doc-process': read('supabase', 'functions', 'doc-process', 'index.ts'),
    'task-embed': read('supabase', 'functions', 'task-embed', 'index.ts'),
    'enrich-task': read('supabase', 'functions', 'enrich-task', 'index.ts'),
  };

  it('все корпусы используют одну модель', () => {
    for (const [name, src] of Object.entries(files)) {
      expect(src, `${name} должен использовать ${EMBEDDING_MODEL}`).toContain(
        `'${EMBEDDING_MODEL}'`,
      );
    }
  });

  it('нигде не осталось bge-m3 — он считался в другом пространстве, чем документы', () => {
    for (const [name, src] of Object.entries(files)) {
      const code = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n');
      expect(code, `${name}: bge-m3 не должен оставаться в коде`).not.toContain('bge-m3');
    }
  });

  it('индексация использует префикс passage:, поиск — query:', () => {
    // doc-process пишет литерал `passage: `, task-embed — через константу.
    // Проверяем наличие самого префикса в шаблоне input, а не форму записи.
    expect(files['doc-process']).toMatch(/`passage: \$\{/);
    expect(files['task-embed']).toMatch(/`\$\{PASSAGE_PREFIX\}\$\{/);
    expect(files['enrich-task']).toContain(`QUERY_PREFIX = '${QUERY_PREFIX}'`);
    expect(files['enrich-task']).toContain(`PASSAGE_PREFIX = '${PASSAGE_PREFIX}'`);
  });

  it('enrich-task пишет вектор с passage-префиксом и ищет с query-префиксом', () => {
    // Запись вектора задачи — сторона документа.
    expect(files['enrich-task']).toContain(
      'generateEmbedding(queryText, neuralDeepKey, PASSAGE_PREFIX)',
    );
    // Поиск по match_tasks / match_doc_chunks — сторона запроса.
    expect(files['enrich-task']).toContain('generateEmbedding(queryText, apiKey, QUERY_PREFIX)');
  });
});

describe('Контракт хеша содержимого задачи', () => {
  const INPUT_EXPR = "`${title}\\0${description ?? ''}`";

  it('task-embed и enrich-task хешируют одинаково', () => {
    for (const slug of ['task-embed', 'enrich-task']) {
      const src = read('supabase', 'functions', slug, 'index.ts');
      expect(src, `${slug}: формула хеша должна быть \${title}\\0\${description}`).toContain(
        INPUT_EXPR,
      );
      expect(src, `${slug}: хеш должен быть SHA-256`).toContain("'SHA-256'");
    }
  });

  it('эталонный вектор: хеш воспроизводим и меняется при смене описания', () => {
    const hash = (title: string, description: string | null) =>
      createHash('sha256')
        .update(Buffer.from(`${title}\0${description ?? ''}`, 'utf8'))
        .digest('hex');

    const base = hash('Починить парсер', 'Описание');
    expect(base).toHaveLength(64);
    expect(hash('Починить парсер', 'Описание')).toBe(base);          // детерминирован
    expect(hash('Починить парсер', 'Другое')).not.toBe(base);          // чувствителен к описанию
    expect(hash('Починить парсер', null)).not.toBe(base);              // null ≠ ''
  });
});

describe('Контракт статусов документа', () => {
  it('TS-union совпадает с CHECK-констрейнтом workspace_documents.status', () => {
    const migration = read('supabase', 'migrations', '001_init.sql');
    // CHECK задан анонимно внутри CREATE TABLE, имени-констрейнта в тексте
    // миграции нет (оно появляется только в pg_constraint). Поэтому вырезаем
    // блок таблицы и достаём оттуда CHECK по колонке status.
    const table = migration.match(
      /CREATE TABLE public\.workspace_documents \(([\s\S]*?)\n\);/,
    );
    expect(table, 'не найден CREATE TABLE workspace_documents в 001_init.sql').not.toBeNull();

    const check = table![1].match(/CHECK \(status IN \(([^)]+)\)\)/);
    expect(check, 'не найден CHECK (status IN ...) в DDL workspace_documents').not.toBeNull();

    const dbStatuses = check![1]
      .split(',')
      .map((s) => s.replace(/'/g, '').trim())
      .filter(Boolean)
      .sort();

    const card = read('src', 'components', 'desk-create', 'DocumentsCard.tsx');
    const union = card.match(/export type DocumentStatus\s*=\s*([^;]+);/);
    expect(union, 'не найден тип DocumentStatus').not.toBeNull();

    const uiStatuses = (union![1].match(/"([^"]+)"/g) ?? [])
      .map((s) => s.replace(/"/g, ''))
      .sort();

    expect(
      uiStatuses,
      'DocumentStatus в UI расходится с БД: значение, которого нет в CHECK, ' +
        'не отрисуется, а значение из CHECK без ветки отрисовки потеряется',
    ).toEqual(dbStatuses);
  });

  it('все статусы из БД обработаны в рендерере', () => {
    const card = read('src', 'components', 'desk-create', 'DocumentsCard.tsx');
    for (const renderer of ['renderStatusIcon', 'renderStatusLabel']) {
      const body = card.match(new RegExp(`${renderer}[\\s\\S]*?\\n  \\};`));
      expect(body, `не найден ${renderer}`).not.toBeNull();
      for (const status of ['processing', 'ready', 'failed']) {
        expect(body![0], `${renderer} не обрабатывает '${status}'`).toContain(`"${status}"`);
      }
    }
  });
});
