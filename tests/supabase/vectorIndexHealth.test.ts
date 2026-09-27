import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Проверка здоровья векторных индексов (миграции 131/132).
 *
 * ⚠️ Последний describe читает SQL-миграцию как текст, поэтому сам по себе не
 * доказывает исполнение (AGENTS.md §5). Настоящая гарантия — сама функция
 * `assert_vector_index_health()` в БД: её вызов приводит к тому, что
 * `pgvector` и прикладной код остаются под защитой независимо от этого файла.
 * Проверки текста ниже существуют, чтобы страж не исчез молча.
 *
 * Предыстория. На `tasks` стоял IVFFlat `lists=100` при ~50 строках: кластеров
 * больше, чем векторов, recall схлопнулся почти в ноль, `match_tasks` не мог
 * вернуть строку. Это висело неделями незамеченным.
 *
 * Тот же дефект искали в `workspace_doc_chunks` и `agent_memory` — и измерение
 * его НЕ подтвердило: recall 42/42 на 14 чанках, план `Index Scan using
 * idx_doc_chunks_embedding`; 1400 результатов по всем запросам на 280 строках.
 * Оба индекса исправны, менять их не стали. Дефект был виден по ЧИСЛУ, а не по
 * симптому, поэтому закрываем класс проверкой числа, а не очередной миграцией.
 *
 * Правило (намеренно не требует идеала pgvector «>=10 строк на лист»):
 *   - lists > строк на НЕПУСТОЙ таблице → ошибка;
 *   - пустая таблица → исключена: измерять recall нечего, отдавать нечего;
 *   - HNSW → всегда ок, lists к нему не применяется.
 * Требование идеала ругалось бы на `workspace_doc_chunks` (1.4 строки на лист
 * при recall 100%), и проверку начали бы игнорировать.
 */

type Method = 'hnsw' | 'ivfflat';

interface IndexState {
  name: string;
  table: string;
  method: Method;
  /** null для HNSW — параметр lists к нему не применяется. */
  lists: number | null;
  rows: number;
}

/** Зеркалит CASE из vector_index_health() в SQL. */
function verdict(s: IndexState): 'ok' | 'exempt' | 'error' {
  if (s.method === 'hnsw') return 'ok';
  if (s.lists === null) return 'ok';
  if (s.rows === 0) return 'exempt';
  return s.lists > s.rows ? 'error' : 'ok';
}

/** Состояние, измеренное в проде 2026-09-27. */
const MEASURED: IndexState[] = [
  { name: 'idx_tasks_embedding', table: 'tasks', method: 'hnsw', lists: null, rows: 51 },
  {
    name: 'idx_doc_chunks_embedding',
    table: 'workspace_doc_chunks',
    method: 'ivfflat',
    lists: 10,
    rows: 14,
  },
  {
    name: 'idx_agent_memory_embedding',
    table: 'agent_memory',
    method: 'ivfflat',
    lists: 50,
    rows: 0,
  },
];

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const healthSql = ['131_vector_index_health_check.sql', '132_fix_vector_health_scope.sql']
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

describe('правило здоровья векторных индексов', () => {
  it('ловит исходный боевой случай: tasks lists=100 при 50 строках', () => {
    expect(
      verdict({ name: 'x', table: 'tasks', method: 'ivfflat', lists: 100, rows: 50 }),
    ).toBe('error');
  });

  it('не ругается на HNSW независимо от lists', () => {
    expect(verdict({ name: 'x', table: 't', method: 'hnsw', lists: null, rows: 10 })).toBe(
      'ok',
    );
  });

  it('исключает пустую таблицу: измерять recall нечего', () => {
    expect(verdict({ name: 'x', table: 't', method: 'ivfflat', lists: 100, rows: 0 })).toBe(
      'exempt',
    );
  });

  it('прощает lists == строк (предельный, но не вырожденный случай)', () => {
    expect(verdict({ name: 'x', table: 't', method: 'ivfflat', lists: 50, rows: 50 })).toBe(
      'ok',
    );
  });

  it('не требует идеала pgvector: doc_chunks живёт на 1.4 строки на лист', () => {
    expect(
      verdict({ name: 'x', table: 'workspace_doc_chunks', method: 'ivfflat', lists: 10, rows: 14 }),
    ).toBe('ok');
  });
});

describe('текущее состояние базы', () => {
  it('ни один измеренный индекс не нарушает правило', () => {
    const bad = MEASURED.filter((s) => verdict(s) === 'error').map((s) => s.name);
    expect(bad).toEqual([]);
  });

  it('инвентарь векторных индексов совпадает с замеренным', () => {
    // Любой новый векторный индекс обязан быть сюда внесён: правило требует
    // знать реальное число строк, а оно живёт только в базе.
    const expected = MEASURED.map((s) => `${s.table}.${s.method}`).sort();
    expect(expected).toEqual(
      ['agent_memory.ivfflat', 'tasks.hnsw', 'workspace_doc_chunks.ivfflat'].sort(),
    );
  });
});

describe('проверка не может быть удалена молча', () => {
  it('в миграциях есть диагностическая функция', () => {
    expect(healthSql).toContain('FUNCTION public.vector_index_health()');
  });

  it('в миграциях есть функция, которая падает', () => {
    expect(healthSql).toContain('FUNCTION public.assert_vector_index_health()');
    expect(healthSql).toMatch(/RAISE EXCEPTION/);
  });

  it('диагностика ограничена схемой public (иначе ловит каталоги pgvector)', () => {
    // Регрессия 131: фильтр по '%vector%' захватывал vector_indexes и
    // buckets_vectors — служебные таблицы расширения.
    expect(healthSql).toMatch(/schemaname\s*=\s*'public'/);
  });

  it('пустые таблицы исключены явным правилом, а не случайно', () => {
    expect(healthSql).toMatch(/row_count\s*=\s*0/);
  });

  it('ошибка проверяется именно как lists > строк', () => {
    expect(healthSql).toMatch(/lists_param\s*>\s*p\.row_count/);
  });
});

describe('миграция не ломает соседние файлы', () => {
  it('в каталоге миграций нет дубля номера 131/132', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    const numbered = files.filter((f) => /^(131|132)_/.test(f));
    expect(numbered).toHaveLength(2);
  });
});
