import { describe, it, expect } from 'vitest';
import {
  buildHeader,
  buildOpenButton,
  buildTaskNotifyCard,
  renderTaskCardBody,
  subtaskCommentsDeepLink,
  subtaskDeepLink,
  type TaskCardData,
} from '../../supabase/functions/bot-notify/card';

const makeCard = (over: Partial<TaskCardData> = {}): TaskCardData => ({
  fullId: 'ONI-42-SUB-1',
  title: 'Написать текст',
  description: null,
  column: 'backlog',
  isInbox: false,
  isBlocked: false,
  priority: 'medium',
  dueDate: null,
  assigneeName: 'Пётр',
  assignedByName: 'Анна',
  workspaceHandle: 'acme',
  clarityScore: null,
  ...over,
});

const SUBTASK = {
  index: 1,
  parentFullId: 'ONI-42',
  parentTitle: 'Релиз сайта',
};

describe('SUB-01: заголовок карточки подзадачи', () => {
  it('assigned: «Подзадача», а не «Задача»', () => {
    // Регрессия: notify_task_assignment не имеет гарда на подзадачи, поэтому
    // при назначении исполнителя подзадаче приходило «Задача ONI-42-SUB-1
    // назначена на тебя» — человек не понимал, что это пункт внутри задачи.
    expect(buildHeader('assigned', 'ONI-42-SUB-1', true)).toBe(
      '📝 Подзадача <b>ONI-42-SUB-1</b> назначена на тебя',
    );
  });

  it('для самостоятельной задачи слово прежнее — «Задача»', () => {
    expect(buildHeader('assigned', 'ONI-42', false)).toBe(
      '📝 Задача <b>ONI-42</b> назначена на тебя',
    );
    // Значение по умолчанию = прежнее поведение (обратная совместимость).
    expect(buildHeader('assigned', 'ONI-42')).toBe(
      '📝 Задача <b>ONI-42</b> назначена на тебя',
    );
  });

  it('остальные контексты тоже говорят «Подзадача»', () => {
    expect(buildHeader('done', 'ONI-42-SUB-1', true)).toContain('Подзадача');
    expect(buildHeader('review', 'ONI-42-SUB-1', true)).toContain('Подзадача');
    expect(buildHeader('done_approved', 'ONI-42-SUB-1', true)).toContain('подзадачи');
    expect(buildHeader('handoff', 'ONI-42-SUB-1', true)).toContain('Подзадача');
  });

  it('смена слова не ломает контексты без «Задачи» в шаблоне', () => {
    // escalation/deadline в шаблоне слова не содержат — переключение не должно
    // их менять (иначе «Подзадача» протекла бы в «Осталось 2 дня» и т.п.).
    const noNounContexts = [
      'escalation', 'deadline', 'deadline_overdue', 'cascade', 'duplicate',
    ] as const;
    for (const ctx of noNounContexts) {
      expect(buildHeader(ctx, 'ONI-42-SUB-1', true)).toBe(
        buildHeader(ctx, 'ONI-42-SUB-1', false),
      );
    }
  });
});

describe('SUB-01: deep link карточки подзадачи', () => {
  it('кнопка ведёт в namespace subtask_, а не task_', () => {
    // Главный баг: task_ONI-42-SUB-1 не проходит parseStartParam (task_ ждёт
    // ровно [A-Za-z]+-\d+), то есть ссылка была мёртвой — приложение
    // открывалось и ничего не показывало.
    const btn = buildOpenButton(makeCard({ subtask: SUBTASK }), 'assigned');
    expect(btn.url).toBe(
      'https://t.me/onitaskbot/onitask?startapp=subtask_ONI-42-SUB-1',
    );
  });

  it('review-контекст подзадачи → subtask_ + _comments', () => {
    const btn = buildOpenButton(makeCard({ subtask: SUBTASK }), 'review');
    expect(btn.url).toBe(
      'https://t.me/onitaskbot/onitask?startapp=subtask_ONI-42-SUB-1_comments',
    );
  });

describe('SUB-01: тело карточки подзадачи', () => {
  it('показывает родителя: «в задаче ONI-42 — Релиз сайта · подзадача 1»', () => {
    const text = renderTaskCardBody(makeCard({ subtask: SUBTASK }));
    expect(text).toContain('🗂');
    expect(text).toContain('в задаче ONI-42 — Релиз сайта · подзадача 1');
  });

  it('без subtask строки родителя нет — прежняя карточка не изменилась', () => {
    const text = renderTaskCardBody(makeCard({ fullId: 'ONI-42' }));
    expect(text).not.toContain('🗂');
    expect(text).not.toContain('в задаче');
  });

  it('родитель без названия, но с id — строка всё равно полезна', () => {
    const text = renderTaskCardBody(
      makeCard({ subtask: { index: 2, parentFullId: 'ONI-42', parentTitle: null } }),
    );
    expect(text).toContain('в задаче ONI-42 · подзадача 2');
  });

  it('HTML в названии родителя экранируется', () => {
    const text = renderTaskCardBody(
      makeCard({ subtask: { index: 1, parentFullId: 'ONI-42', parentTitle: '<b>&x</b>' } }),
    );
    expect(text).toContain('&lt;b&gt;&amp;x&lt;/b&gt;');
    expect(text).not.toContain('<b>&x</b>');
  });

  it('длинное название родителя обрезается', () => {
    const long = 'я'.repeat(200);
    const text = renderTaskCardBody(
      makeCard({ subtask: { index: 1, parentFullId: 'ONI-42', parentTitle: long } }),
    );
    expect(text).toContain('…');
    expect(text).not.toContain(long);
  });

  it('индекс null → «подзадача» без номера, строка не ломается', () => {
    const text = renderTaskCardBody(
      makeCard({ subtask: { index: null, parentFullId: 'ONI-42', parentTitle: 'Релиз' } }),
    );
    expect(text).toContain('в задаче ONI-42 — Релиз · подзадача');
  });
});

describe('SUB-01: карточка целиком', () => {
  it('собирается: заголовок «Подзадача», строка родителя, ссылка subtask_', () => {
    const card = buildTaskNotifyCard(makeCard({ subtask: SUBTASK }), 'assigned');
    expect(card.text).toContain('Подзадача <b>ONI-42-SUB-1</b> назначена на тебя');
    expect(card.text).toContain('в задаче ONI-42 — Релиз сайта');
    expect(card.text).not.toContain('Задача <b>ONI-42-SUB-1</b>');
    const url = card.replyMarkup.inline_keyboard[0][0].url;
    expect(url).toContain('startapp=subtask_ONI-42-SUB-1');
  });

  it('текст укладывается в лимит Telegram 4096', () => {
    const card = buildTaskNotifyCard(
      makeCard({ subtask: SUBTASK, title: 'я'.repeat(500), description: 'я'.repeat(2000) }),
      'assigned',
    );
    expect(card.text.length).toBeLessThanOrEqual(4096);
  });
});


  it('для самостоятельной задачи ссылка прежняя — task_', () => {
    expect(buildOpenButton(makeCard({ fullId: 'ONI-42' }), 'assigned').url).toBe(
      'https://t.me/onitaskbot/onitask?startapp=task_ONI-42',
    );
  });

  it('start_param из букв/цифр/дефисов — ограничения Telegram соблюдены', () => {
    // start_param допускает только [A-Za-z0-9_-], максимум 512 символов.
    for (const url of [subtaskDeepLink('ONI-42-SUB-1'), subtaskCommentsDeepLink('ONI-42-SUB-1')]) {
      const param = url.split('startapp=')[1];
      expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(param.length).toBeLessThanOrEqual(512);
    }
  });
});
