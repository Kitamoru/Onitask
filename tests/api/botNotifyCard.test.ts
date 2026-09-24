// Tests for supabase/functions/bot-notify/card.ts — pure card builders.
// Extracted from index.ts (086) so the done/done_approved contract is
// unit-testable in node-env without the Deno runtime.
import { describe, it, expect } from 'vitest';
import {
  buildTaskNotifyCard,
  taskDeepLink,
  CARD_CONFIG,
  type NotifyContext,
  type TaskCardData,
} from '../../supabase/functions/bot-notify/card';

const makeCard = (over: Partial<TaskCardData> = {}): TaskCardData => ({
  fullId: 'ONI-42',
  title: 'Починить ленту',
  description: null,
  column: 'done',
  isInbox: false,
  isBlocked: false,
  priority: 'medium',
  dueDate: null,
  assigneeName: 'Иван',
  assignedByName: 'Пётр',
  workspaceHandle: 'acme',
  clarityScore: null,
  ...over,
});

describe('bot-notify card: названия колонок', () => {
  it.each([
    ['backlog', 'В очереди'],
    ['in_progress', 'В работе'],
    ['review', 'На проверке'],
    ['done', 'Сделано'],
  ])('%s отображается как «%s»', (column, label) => {
    const res = buildTaskNotifyCard(makeCard({ column }), 'assigned');
    expect(res.text).toContain(`📍 ${label} · acme`);
    expect(res.text).not.toContain('📍 Бэклог');
    expect(res.text).not.toContain('📍 Готово');
  });
});

describe('bot-notify card: done vs done_approved (086)', () => {
  it('done: заголовок «выполнена», без строки о переносе, без кнопок решения', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done', { reason: 'отчёт агента' });
    expect(res.text).toContain('✅ Задача <b>ONI-42</b> выполнена');
    expect(res.text).not.toContain('согласован');
    expect(res.text).not.toContain('Задача перенесена в Сделано.');
    expect(res.text).toContain('Результат: отчёт агента');
    const rows = res.replyMarkup.inline_keyboard;
    expect(rows.flat().some((b) => b.callback_data?.startsWith('ra:'))).toBe(false);
  });

  it('done_approved: заголовок «Результат … согласован» + строка о переносе в Сделано', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done_approved', { reason: 'итог' });
    expect(res.text).toContain('✅ Результат задачи <b>ONI-42</b> согласован');
    expect(res.text).toContain('Задача перенесена в Сделано.');
    expect(res.text).toContain('Результат: итог');
    const rows = res.replyMarkup.inline_keyboard;
    expect(rows.flat().some((b) => b.callback_data?.startsWith('ra:'))).toBe(false);
  });

  it('done_approved без reason — заголовок и перенос есть, строки «Результат:» нет', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done_approved');
    expect(res.text).toContain('✅ Результат задачи <b>ONI-42</b> согласован');
    expect(res.text).toContain('Задача перенесена в Сделано.');
    expect(res.text).not.toContain('Результат:');
  });

  it('причина экранируется (HTML-инъекция невозможна)', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done', { reason: '<b>hack</b>' });
    expect(res.text).toContain('Результат: &lt;b&gt;hack&lt;/b&gt;');
  });
});

describe('bot-notify card: deadline форматирование (BOT-11)', () => {
  it('overdue ≥ 24ч — дни с плюрализацией, не часы', () => {
    const res = buildTaskNotifyCard(
      makeCard({ column: 'in_progress' }),
      'deadline_overdue',
      { hoursLeft: -240 },
    );
    expect(res.text).toContain('🔴 Дедлайн пропущен · <b>ONI-42</b>');
    expect(res.text).toContain('Просрочено на ~10 дней');
    expect(res.text).not.toContain('240');
  });

  it('< 24ч — часы', () => {
    const res = buildTaskNotifyCard(makeCard({ column: 'in_progress' }), 'deadline', {
      hoursLeft: 5,
    });
    expect(res.text).toContain('📅 Дедлайн скоро · <b>ONI-42</b>');
    expect(res.text).toContain('Осталось ~5ч');
  });

  it('24–48ч — «~2 дня» (плюрализация дня/дня/дней)', () => {
    const res = buildTaskNotifyCard(makeCard({ column: 'in_progress' }), 'deadline', {
      hoursLeft: 48,
    });
    expect(res.text).toContain('Осталось ~2 дня');
  });
});

describe('bot-notify card: регрессии контекстов', () => {
  it('review: клавиатура согласовать/вернуть + подсказка', () => {
    const res = buildTaskNotifyCard(
      makeCard({ column: 'review' }),
      'review',
      { reason: 'сделал фичу', taskId: 'uuid-1' },
    );
    expect(res.text).toContain('🔎 Задача <b>ONI-42</b> ждет вашей проверки');
    expect(res.text).toContain('Результат: сделал фичу');
    expect(res.text).not.toContain('Что сделано:'); // 086: лейбл заменён
    const callbacks = res.replyMarkup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean);
    expect(callbacks).toContain('ra:approve:uuid-1');
    expect(res.replyMarkup.inline_keyboard[0][0].text).toBe('✅ Согласовать');
    expect(callbacks).toContain('ra:fix:uuid-1');
  });

  it('escalation сохраняет «Причина:»/«Предлагаю:» (не «Результат:»)', () => {
    const res = buildTaskNotifyCard(makeCard(), 'escalation', {
      reason: 'нет доступа',
      suggestedAction: 'выдать роль',
    });
    expect(res.text).toContain('Причина: нет доступа');
    expect(res.text).toContain('Предлагаю: выдать роль');
    expect(res.text).not.toContain('Результат: нет доступа');
  });

  it('done без reason — нет пустой строки «Результат:»', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done');
    expect(res.text).not.toContain('Результат:');
  });
});

describe('bot-notify card: 🔍 Проверяющий (087)', () => {
  it('reviewerName есть → строка «🔍 Проверяющий» присутствует', () => {
    const res = buildTaskNotifyCard(makeCard({ reviewerName: 'Анна' }), 'done');
    expect(res.text).toContain('🔍 Проверяющий: @Анна');
    // порядок: после Постановщика
    expect(res.text.indexOf('✍️ Постановщик:')).toBeLessThan(
      res.text.indexOf('🔍 Проверяющий:')
    );
  });

  it('reviewerName = null → «🔍 Проверяющий: —» (единообразно с Постановщиком)', () => {
    const res = buildTaskNotifyCard(makeCard({ reviewerName: null }), 'done');
    expect(res.text).toContain('🔍 Проверяющий: —');
  });

  it('reviewerName не передана (undefined, старые caller-ы) → строки нет', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done');
    expect(res.text).not.toContain('Проверяющий');
  });
});

describe('bot-notify card: deep-link', () => {
  it('open-button ведёт в мини-апп на задачу', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done');
    const btn = res.replyMarkup.inline_keyboard.flat().find((b) => b.url);
    expect(btn?.url).toBe('https://t.me/onitaskbot/onitask?startapp=task_ONI-42');
    expect(taskDeepLink('ONI-1')).toBe(
      'https://t.me/onitaskbot/onitask?startapp=task_ONI-1',
    );
  });

  it('CARD_CONFIG.botUsername перекрывает дефолт (env TELEGRAM_BOT_USERNAME)', () => {
    const prev = CARD_CONFIG.botUsername;
    try {
      CARD_CONFIG.botUsername = 'custombot';
      expect(taskDeepLink('ONI-1')).toBe(
        'https://t.me/custombot/onitask?startapp=task_ONI-1',
      );
    } finally {
      CARD_CONFIG.botUsername = prev;
    }
  });
});

describe('bot-notify card: корень эскалации (nack_reason/nack_detail)', () => {
  it('max_attempts: показывает ошибку последней попытки и её детали', () => {
    const res = buildTaskNotifyCard(makeCard(), 'escalation', {
      reason: 'max_attempts',
      nackReason: 'transient_error',
      nackDetail: 'bad_response: Агент вернул не JSON-контракт | keys: task_id, status',
    });
    expect(res.text).toContain('Причина: max_attempts');
    expect(res.text).toContain('Последняя попытка: transient_error');
    expect(res.text).toContain('Детали: bad_response: Агент вернул не JSON-контракт');
    expect(res.text).toContain('keys: task_id, status');
  });

  it('nack_reason совпадает с escalation_reason → строка не дублируется', () => {
    const res = buildTaskNotifyCard(makeCard(), 'escalation', {
      reason: 'unsupported_task',
      nackReason: 'unsupported_task',
      nackDetail: 'unauthorized: Ключ агента отклонён',
    });
    expect(res.text).toContain('Причина: unsupported_task');
    expect(res.text).not.toContain('Последняя попытка:');
    expect(res.text).toContain('Детали: unauthorized: Ключ агента отклонён');
  });

  it('без nack_* — обратная совместимость (только «Причина:»)', () => {
    const res = buildTaskNotifyCard(makeCard(), 'escalation', { reason: 'нет доступа' });
    expect(res.text).toContain('Причина: нет доступа');
    expect(res.text).not.toContain('Последняя попытка:');
    expect(res.text).not.toContain('Детали:');
  });

  it('детали экранируются и обрезаются до 300 символов', () => {
    const res = buildTaskNotifyCard(makeCard(), 'escalation', {
      reason: 'max_attempts',
      nackDetail: `<b>${'x'.repeat(500)}`,
    });
    // Обрезка до 300 символов идёт до экранирования: '<b>' + 297 'x' + '…'
    expect(res.text).toContain(`Детали: &lt;b&gt;${'x'.repeat(297)}…`);
    expect(res.text).not.toContain('x'.repeat(400));
  });

  it('не-escalation контексты nack_* игнорируют', () => {
    const res = buildTaskNotifyCard(makeCard(), 'done', {
      reason: 'отчёт',
      nackReason: 'transient_error',
      nackDetail: 'boom',
    });
    expect(res.text).toContain('Результат: отчёт');
    expect(res.text).not.toContain('Детали:');
  });
});
