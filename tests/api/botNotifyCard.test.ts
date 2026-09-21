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