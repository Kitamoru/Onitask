import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';

/**
 * Аудит `upsert` по схеме.
 *
 * Найдено 2026-09-27 при E2E-проверке F-03. Сценарий:
 *   `supabase.from('task_enrichments').upsert({ task_id, ... })` без
 *   `onConflict`. PostgREST при `resolution=merge-duplicates` без явного
 *   конфликтного столбца ориентируется на ПЕРВИЧНЫЙ КЛЮЧ таблицы, а у
 *   task_enrichments PK = `id`, которого в payload нет. Генерируется новый
 *   uuid, конфликта по `id` не происходит, идёт INSERT — и падает на
 *   UNIQUE(task_id):
 *
 *     duplicate key value violates unique constraint "task_enrichments_task_id_key"
 *
 *   В Edge Function ошибка не проверялась: джоб помечался `done`, функция
 *   отвечала "Task enriched successfully", в БД — пусто. В Route Handler
 *   ошибка проверялась, но пользователь получал 500 при ручной правке
 *   Story Points.
 *
 *   Ломалось всё повторное: ретраи по F03-10 (handleFailure сам создаёт
 *   строку `pending` перед ретраем) и ручная правка SP у обогащённой задачи.
 *
 * Разбор делается через AST, а не регулярками по тексту: первая версия теста
 * искала `onConflict` в окне из 40 строк и давала ложноотрицательный результат
 * — подхватывала onConflict соседнего вызова. Проверено мутацией.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'lib', 'supabase/functions'];

/** Таблицы, у которых PK не совпадает с натуральным ключом payload. */
const PK_NOT_PAYLOAD_KEY = new Set(['task_enrichments']);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

interface UpsertSite {
  file: string;
  line: number;
  table: string;
  hasOnConflict: boolean;
}

function hasOnConflictOption(call: ts.CallExpression): boolean {
  const opts = call.arguments[1];
  if (!opts || !ts.isObjectLiteralExpression(opts)) return false;
  return opts.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      ((ts.isIdentifier(p.name) && p.name.text === 'onConflict') ||
        (ts.isStringLiteral(p.name) && p.name.text === 'onConflict')),
  );
}

function findUpserts(): UpsertSite[] {
  const sites: UpsertSite[] = [];

  for (const dir of SCAN_DIRS) {
    let files: string[];
    try {
      files = walk(join(ROOT, dir));
    } catch {
      continue;
    }

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          if (node.expression.name.text === 'upsert') {
            const owner = node.expression.expression; // supabase.from('x').upsert(...)
            if (
              ts.isCallExpression(owner) &&
              ts.isPropertyAccessExpression(owner.expression) &&
              owner.expression.name.text === 'from' &&
              owner.arguments.length > 0 &&
              ts.isStringLiteral(owner.arguments[0])
            ) {
              const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
              sites.push({
                file: relative(ROOT, file).split(sep).join('/'),
                line: line + 1,
                table: owner.arguments[0].text,
                hasOnConflict: hasOnConflictOption(node),
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return sites;
}

describe('upsert: конфликтный столбец указан явно', () => {
  const sites = findUpserts();

  it('находит upsert-вызовы для проверки', () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it('анализатор вообще умеет видеть onConflict (контрольный пример)', () => {
    const withOpt = sites.filter((s) => s.hasOnConflict);
    expect(
      withOpt.length,
      'ни одного upsert с onConflict не найдено — вероятно, анализатор не работает',
    ).toBeGreaterThan(0);
  });

  for (const table of PK_NOT_PAYLOAD_KEY) {
    it(`все upsert по '${table}' содержат onConflict`, () => {
      const offenders = sites
        .filter((s) => s.table === table && !s.hasOnConflict)
        .map((s) => `${s.file}:${s.line}`);
      expect(
        offenders,
        `PK у ${table} = 'id', а он не входит в payload. Без onConflict PostgREST ` +
          `делает INSERT и падает на UNIQUE(task_id). Найдено: ${offenders.join(', ')}`,
      ).toEqual([]);
    });
  }
});
