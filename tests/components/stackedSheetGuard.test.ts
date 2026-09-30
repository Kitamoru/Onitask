import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож на `stacked` у вложенных BottomSheet.
 *
 * ⚠️ Это проверка ИСХОДНОГО ТЕКСТА, а не поведения (AGENTS.md §5). В проекте нет
 * RTL, отрендерить шторку и посмотреть z-index здесь нечем. Тест не доказывает,
 * что шторка визуально перекрывает родительскую — он доказывает только, что проп
 * не потерялся при правке вызова.
 *
 * ЗАЧЕМ. `BottomSheet` создаёт свой transform-контекст, поэтому вложенная
 * `WorkerSelectSheet` без `stacked` рисуется ПОД ней. Кнопка выглядит рабочей,
 * а по факту ничего не открывает — ровно тот баг, что дважды уехал в прод:
 * сначала в `SubtaskViewSheet`, потом в `SubtaskCreateSheet` («не могу выбрать
 * исполнителя»). Дешёвый grep ловит регрессию сразу, а не по жалобе.
 */

const COMPONENTS_DIR = join(__dirname, '../../src/components');

function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Возвращает текст открывающего тега <WorkerSelectSheet ...> для каждого вхождения. */
function workerSelectSheetOpenTags(): Array<{ file: string; tag: string }> {
  const found: Array<{ file: string; tag: string }> = [];
  for (const file of collectTsxFiles(COMPONENTS_DIR)) {
    const src = readFileSync(file, 'utf8');
    let idx = src.indexOf('<WorkerSelectSheet');
    while (idx !== -1) {
      const end = src.indexOf('/>', idx);
      if (end === -1) break;
      found.push({ file: file.replace(/\\/g, '/'), tag: src.slice(idx, end + 2) });
      idx = src.indexOf('<WorkerSelectSheet', end);
    }
  }
  return found;
}

describe('WorkerSelectSheet: проп stacked', () => {
  const usages = workerSelectSheetOpenTags();

  it('хотя бы одно использование существует — иначе тест проходит вхолостую', () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it('каждое подключение внутри BottomSheet получает stacked', () => {
    // Комментарии вырезаем ОБЯЗАТЕЛЬНО. Первая версия проверяла `\bstacked\b`
    // прямо в теге — и проходила на сломанном коде: слово «stacked» осталось
    // в поясняющем комментарии «Без `stacked` шторка ложилась ПОД эту…».
    // Ровно тот ложный зелёный, который AGENTS.md §5 описывает как «функция
    // упомянута, а не вызвана».
    const missing = usages
      .filter((u) => !/\bstacked\b/.test(u.tag.replace(/\/\/[^\n]*/g, '')))
      .map((u) => u.file);
    expect(missing).toEqual([]);
  });
});
