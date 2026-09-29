// Tests for agent-runtime provider contract: summary/details/attachments are separate.
import { describe, it, expect } from 'vitest';
import {
  buildMessages,
  formatHumanDetails,
  normalizeResult,
  rawPreviewOf,
} from '../../supabase/functions/agent-runtime/provider';

const makeRequest = () => ({
  baseUrl: 'https://example.test',
  apiKey: 'secret',
  model: null,
  skills: [],
  autonomy: 'tasks',
  workspaceName: null,
  task: {
    full_id: 'ONIT-36',
    title: 'Закупить огурцы и водку',
    description: null,
    column: 'in_progress',
    priority: 'medium',
    deadline: null,
    is_blocked: false,
    metadata: {},
  },
  comments: [],
  subgraph: [],
});

describe('agent-runtime provider: result contract', () => {
  it('strict result keeps summary, details and attachments separate', () => {
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
      details: 'Полный отчёт с поставщиками и следующими шагами',
      metadata: { document_format: 'xlsx' },
      next_owner: null,
      attachments: [{ filename: 'suppliers.xlsx', source_path: 'out/suppliers.xlsx' }],
    });
    expect(result).toMatchObject({
      outcome: 'review',
      summary: 'Краткий итог',
      details: 'Полный отчёт с поставщиками и следующими шагами',
      attachments: [{ filename: 'suppliers.xlsx', source_path: 'out/suppliers.xlsx' }],
      claimedFiles: [],
      coerced: false,
    });
  });

  it('файл с одним лишь storage_path уходит в claimedFiles, а не в attachments', () => {
    // Регресс на удаление канала storage_path (2026-09-29). Проверка именно
    // на РЕЗУЛЬТАТ разбора: пока collectArtifacts принимал storage_path как
    // байты, элемент попадал в attachments, persistAttachments писал строку
    // манифеста, и файл чужой задачи молча приклеивался. Теперь имя без
    // содержимого — это заявка, её видно (ровно кейс ONIT-42).
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
      details: 'Отчёт назван и приложен, но байт в ответе нет',
      attachments: [{ filename: 'suppliers.xlsx', storage_path: 'ws-1/t-1/e-1' }],
    });
    expect(result?.attachments).toEqual([]);
    expect(result?.claimedFiles).toEqual(['suppliers.xlsx']);
  });

  it('файл, названный без содержимого, идёт в claimedFiles', () => {
    // Имя без байтов — это заявка, а не результат (ровно тот случай, что стоил
    // нам ONIT-42).
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
      details: 'Отчёт назван, но не приложен',
      report: 'grecheskiy_salat_otchet.xlsx',
    });
    expect(result?.claimedFiles).toEqual(['grecheskiy_salat_otchet.xlsx']);
    expect(result?.attachments).toEqual([]);
  });

  it('legacy envelope does not turn a domain object into a comment', () => {
    const result = normalizeResult({
      task_id: 'ONIT-36',
      status: 'completed',
      result: {
        summary: 'Найдены поставщики',
        suppliers: { cucumbers: 'Agroserver' },
        next_steps: ['Позвонить поставщику'],
      },
    });
    expect(result?.summary).toBe('Найдены поставщики');
    expect(result?.details).toBeNull();
    expect(result?.coerced).toBe(true);
  });

  it('legacy envelope accepts ready-made details text', () => {
    const result = normalizeResult({
      task_id: 'ONIT-36',
      status: 'completed',
      result: {
        summary: 'Найдены поставщики',
        details: 'Поставщики: Agroserver.\nСледующий шаг: позвонить поставщику.',
      },
    });
    expect(result?.details).toContain('Поставщики: Agroserver');
  });

  it('JSON string in details is rejected instead of being shown as raw JSON', () => {
    const details = formatHumanDetails('{"next_steps":["Связаться с поставщиком"]}');
    expect(details).toBeNull();
  });

  it('ordinary details text is preserved without attempting translation', () => {
    const details = formatHumanDetails('Поставщик: METRO. Следующий шаг: оформить заказ.');
    expect(details).toBe('Поставщик: METRO. Следующий шаг: оформить заказ.');
  });

  it('строгий review без details отклоняется', () => {
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
    });
    expect(result).toBeNull();
  });

  it('контракт доходит в USER-сообщении, а не в system', () => {
    // Ключевое утверждение, а не текст ради текста: замер 2026-09-27 показал,
    // что до агента доходит только user-сообщение, а system с контрактом
    // теряется платформой. Проверка только на system пропустила бы возврат
    // к прежней (сломанной) раскладке.
    // buildMessages возвращает массив ОБЪЕКТОВ {role, content} — без .content
    // здесь сравнивались бы сами объекты, а не текст промпта.
    const [systemMsg, userMsg] = buildMessages(makeRequest());
    const system = systemMsg.content;
    const user = userMsg.content;

    expect(user).toContain('details');
    expect(user).toContain('attachments');
    expect(user).toContain('xlsx');
    expect(user).toContain('docx');
    // Сжатие промта не должно выкинуть требование приложить файл: именно
    // его не хватало в ONIT-42, где модель назвала отчёт и прошла как успех.
    expect(user).toContain('source_path');
    expect(user).toContain('Запрещено упоминать файл в summary, если он не приложен в attachments');

    // Контракт лежит в user целиком, system отсылает к нему, а не дублирует:
    // два полных контракта в промпте — лишние токены без выигрыша.
    expect(system).toContain('контракт');
    expect(system).not.toContain('storage_path');
    expect(user).toContain('=== ДАННЫЕ ЗАДАЧИ ===');
    expect(user).toContain('ONIT-36');
  });

  it('без примера ответа проза сама называет форму вложения и metadata', () => {
    // Пример ответа из промта убран намеренно, отдельным обратимым коммитом:
    // контракт целиком живёт в user, а system до Drift не доходит. Тогда
    // единственное, что держит форму, — описание полей словами. Если прозу
    // потом сократят, полагаясь на «ну там в примере», примера уже нет: агент
    // вернёт вложение без filename, а reviewAttachments его отбросит.
    const user = buildMessages(makeRequest())[1].content;

    expect(user).not.toContain('sluzhebnaya_zapiska');
    expect(user).toContain('{filename, source_path, caption?}');
    expect(user).toContain('filename обязателен');
    expect(user).toContain('metadata:');
    expect(user).toContain('claimed_files');
  });

  it('в промте нет ни заливки по ссылке, ни base64: файл забираем сами по source_path', () => {
    // Регресс. Смена канала проходит три ступени, и каждая ломалась:
    //   1. Ссылка на загрузку — Drift получил исправный signedUrl, вернул
    //      правильный storage_path и отчитался «Файл успешно загружен»;
    //      объекта в бакете не было.
    //   2. base64 в ответе — работает, но упирается в потолок: hosted-файлы
    //      1.4…6.9 КБ против реальных 25…71 КБ у агента с файловыми
    //      инструментами, и формат деградировал до csv.
    //   3. source_path — файл создаёт инструмент агента, забираем мы.
    // Здесь уместна проверка текста: промт и есть то, что уходит модели, и
    // возврат ЛЮБОГО из двух прежних каналов должен ломать этот тест.
    const user = buildMessages(makeRequest())[1].content;

    expect(user).not.toContain('=== ЗАГРУЗКА ===');
    expect(user).not.toContain('сначала залей');
    expect(user).not.toContain('по ссылке');
    expect(user).not.toContain('storage_path');
    expect(user).not.toContain('content_base64');

    // Единственный канал — путь в workspace агента, и про это сказано прямо.
    expect(user).toContain('source_path');
    expect(user).toContain('write_file');
    // Формат: офисный по умолчанию, подменять молча запрещено. CSV-установка
    // была наследием base64-эры, когда таблица не влезала в потолок ответа;
    // теперь потолка нет, и она только сбивала агента с xlsx/docx на csv.
    expect(user).toContain('xlsx');
    expect(user).toContain('docx');
    expect(user).toContain('Подменять формат молча нельзя');
    expect(user).not.toContain('Табличные данные отдавай в CSV');
  });

  it('промпт объясняет, что делать, если файл отдать нельзя', () => {
    // До этого контракт описывал только обязанность: формат задан, а отказ
    // не определён. Модель придумала выход сама (поле report с именем
    // несуществующего файла) и прошла как успешный прогон.
    const user = buildMessages(makeRequest())[1].content;
    expect(user).toContain('metadata.claimed_files');
  });
});

// ============================================================================
// Реальный ответ агента Drift, задача ONIT-42 (2026-09-27).
//
// Зафиксирован дословно: до этих правок он давал summary из 118 символов,
// 0 вложений, 0 комментариев, и карточка выглядела как «работа выполнена».
// Проверяем поведение на этом входе, а не на синтетике: именно форма
// конверта решает, теряются ли данные.
// ============================================================================

const DRIFT_ONIT_42 = {
  task_id: 'ONIT-42',
  status: 'completed',
  result: {
    report: 'grecheskiy_salat_otchet.xlsx',
    summary:
      'Полный отчёт по закупке ингредиентов для греческого салата в промышленных масштабах (30 кг овощей + доп. ингредиенты).',
    ingredients: {
      основные: [
        { name: 'Помидоры', qty: '15 кг', price: '150-250 руб/кг', total: '2 250-3 750 руб.' },
        { name: 'Огурцы', qty: '15 кг', price: '95-150 руб/кг', total: '1 425-2 250 руб.' },
      ],
      недостающие: [
        { name: 'Перец болгарский', qty: '5 кг', price: '300-500 руб/кг', total: '1 500-2 500 руб.' },
        { name: 'Сыр Фета', qty: '3 кг', price: '800-1 200 руб/кг', total: '2 400-3 600 руб.' },
      ],
    },
    total_cost: '~9 885-16 100 руб. (только ингредиенты)',
    portions: '~170-215 порций (по 200-250 г)',
    suppliers: [{ name: 'Фрутомания', site: 'frutomania.ru' }],
    recommendation:
      'Оптимизировать заказ через Фрутоманию (овощи) + Винум/Дюк (специи, сыр, масло). Экономия на доставке при объединении заказа.',
  },
};

describe('агентский конверт Drift: результат не должен теряться', () => {
  it('recommendation извлекается из вложенного result', () => {
    const result = normalizeResult(DRIFT_ONIT_42);
    expect(result?.recommendation).toBe(DRIFT_ONIT_42.result.recommendation);
  });

  it('recommendation необязателен: без него результат остаётся валидным', () => {
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Готово',
      details: 'Текст результата для комментария',
    });
    expect(result?.recommendation).toBeNull();
  });

  it('имя файла без содержимого становится заявкой, а не вложением', () => {
    const result = normalizeResult(DRIFT_ONIT_42);
    // Ключевой регресс: `report` — строка с именем, байтов нет. Раньше она
    // молча терялась, и прогон выглядел как успешный без артефактов.
    expect(result?.claimedFiles).toEqual(['grecheskiy_salat_otchet.xlsx']);
    expect(result?.attachments).toEqual([]);
  });

  it('заявка собирается из пути провайдера в имя файла', () => {
    const result = normalizeResult({
      task_id: 'ONIT-42',
      status: 'completed',
      result: { summary: 'Отчёт готов', path: '/v1/files/sluzhebnaya_zapiska.docx' },
    });
    // Показываем пользователю имя, а не внутренний путь хранилища агента.
    expect(result?.claimedFiles).toEqual(['sluzhebnaya_zapiska.docx']);
  });

  it('ссылка на файл не превращается ни во вложение, ни в источник загрузки', () => {
    // Намеренно нет поддержки download_url/file_id: фетчить URL, пришедший
    // от модели, — это SSRF (модель управляет хостом, а адрес может прийти
    // из недоверенных description/ai_hint/related_tasks).
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Отчёт готов',
      details: 'Текст',
      attachments: [
        { filename: 'otchet.xlsx', download_url: 'https://onitask.vercel.app/api/files/abc123' },
      ],
    });
    expect(result?.attachments).toEqual([]);
    expect(result?.claimedFiles).toEqual(['otchet.xlsx']);
  });

describe('файлы из нескольких источников', () => {
  it('файл из attachments и файл из report мержатся в один список', () => {
    // Запрошенное владельцем поведение: оба ключа работают, а не первый
    // побеждает. Проверка на исполняемый код — при откате к «||» тест упадёт.
    const result = normalizeResult({
      task_id: 'ONIT-42',
      status: 'completed',
      result: {
        summary: 'Отчёт и смета готовы',
        attachments: [
          { filename: 'note.txt', content_base64: Buffer.from('привет', 'utf8').toString('base64') },
        ],
        report: {
          filename: 'smeta.csv',
          content_base64: Buffer.from('Статья;Сумма\r\nОвощи;5000', 'utf8').toString('base64'),
        },
      },
    });
    expect(result?.attachments.map((a) => a.filename)).toEqual(['note.txt', 'smeta.csv']);
  });
});

describe('превью сырого ответа на успехе', () => {
  it('длинное base64-значение вырезается с сохранением длины', () => {
    const b64 = 'A'.repeat(5000);
    const preview = rawPreviewOf(JSON.stringify({ outcome: 'review', blob: b64 }));
    expect(preview).not.toContain('A'.repeat(500));
    expect(preview).toContain(`<base64 ${b64.length} симв.>`);
  });

  it('короткий ответ укладывается в лимит и сохраняет форму конверта', () => {
    // Ровно то, чего не хватало для диагностики ONIT-42: видно, что ключи
    // верхнего уровня — task_id/status/result, а не контракт Onitask.
    const preview = rawPreviewOf(JSON.stringify(DRIFT_ONIT_42));
    expect(preview).toContain('"task_id"');
    expect(preview).toContain('"status"');
    expect(preview).toContain('"result"');
    expect(preview.length).toBeLessThanOrEqual(800);
  });
});

});

