import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * Контрактные тесты Edge Functions.
 *
 * «Структурная целостность» написана не для красоты. Реальный случай
 * 2026-09-27: при сборке `task-embed` вставка кода попала ВНУТРЬ функции
 * `computeContentHash`, потому что её закрывающая скобка ещё не была дописана.
 *
 * Что при этом НЕ сработало и обесценило обычные проверки:
 *   - баланс скобок — сошёлся (66/66), файл выглядел целым;
 *   - `tsc --noEmit` — exit 0;
 *   - `supabase functions deploy` — успех, статус ACTIVE.
 * Ошибка была чисто семантической: обработчик `serve()` оказался вложенным в
 * невызываемую функцию, поэтому запрос висел вечно, а в БД ничего не писалось.
 *
 * Ловит именно проверка вложенности объявлений.
 */

const FUNCTIONS_DIR = join(process.cwd(), 'supabase', 'functions');

function functionSlugs(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(FUNCTIONS_DIR, e.name, 'index.ts')))
    .map((e) => e.name)
    .sort();
}

function parseFn(slug: string) {
  const text = readFileSync(join(FUNCTIONS_DIR, slug, 'index.ts'), 'utf8');
  const sf = ts.createSourceFile(
    `${slug}.ts`,
    text,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  return { sf, text };
}

/** Имя функции, внутри которой лежит узел (ближайший предок-функция). */
function enclosingFunctionName(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur)) return cur.name?.text ?? '<anon>';
    if (ts.isFunctionExpression(cur)) return '<function-expression>';
    cur = cur.parent;
  }
  return null;
}

function collectFunctionDeclarations(sf: ts.SourceFile): ts.FunctionDeclaration[] {
  const found: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('Edge Function: структурная целостность', () => {
  const slugs = functionSlugs();

  it('находит Edge Functions для проверки', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  for (const slug of slugs) {
    describe(slug, () => {
      it('парсится без синтаксических ошибок', () => {
        const { sf } = parseFn(slug);
        const diags = (sf as any).parseDiagnostics ?? [];
        expect(diags.map((d: any) => String(d.messageText))).toEqual([]);
      });

      it('не объявляет функции внутри других функций', () => {
        const { sf } = parseFn(slug);
        const nested = collectFunctionDeclarations(sf)
          .map((f) => ({ name: f.name!.text, host: enclosingFunctionName(f) }))
          .filter((x) => x.host !== null);

        expect(
          nested.map((x) => `${x.name} внутри ${x.host}`),
          `В ${slug}/index.ts объявления вложены в другие функции. ` +
            `Так ломался task-embed: обработчик serve() оказался внутри ` +
            `computeContentHash — файл остаётся валидным, но запрос зависает навсегда.`,
        ).toEqual([]);
      });

      it('вызывает serve() на верхнем уровне файла', () => {
        const { sf } = parseFn(slug);
        const isServeCall = (st: ts.Statement): boolean => {
          if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return false;
          const callee = st.expression.expression;
          if (ts.isIdentifier(callee)) return callee.text === 'serve';
          // agent-runtime использует Deno.serve(...)
          if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'serve';
          return false;
        };
        const topLevel = sf.statements.filter(isServeCall).length;
        expect(
          topLevel,
          `В ${slug}/index.ts не найден верхнеуровневый вызов serve()/Deno.serve(). ` +
            `Если обработчик вложен в функцию, он не выполнится никогда.`,
        ).toBe(1);
      });
    });
  }
});
