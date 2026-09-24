// Tests for lib/bot.ts renderTaskCardBody — unified task card (§6.2d).
// Covers the Постановщик (assignedByName) / Проверяющий (reviewerName) lines.
import { describe, it, expect } from 'vitest';
import { renderTaskCardBody, type TaskCardData } from '../../lib/bot';

const makeCard = (over: Partial<TaskCardData> = {}): TaskCardData => ({
  fullId: 'ONI-42',
  title: 'Починить ленту',
  column: 'review',
  isInbox: false,
  isBlocked: false,
  priority: 'medium',
  dueDate: null,
  assigneeName: 'Иван',
  workspaceHandle: 'acme',
  clarityScore: null,
  ...over,
});

describe('lib/bot renderTaskCardBody: названия колонок', () => {
  it.each([
    ['backlog', 'В очереди'],
    ['in_progress', 'В работе'],
    ['review', 'На проверке'],
    ['done', 'Сделано'],
  ])('%s отображается как «%s»', (column, label) => {
    const text = renderTaskCardBody(makeCard({ column }));
    expect(text).toContain(`📍 ${label} · acme`);
    expect(text).not.toContain('📍 Бэклог');
    expect(text).not.toContain('📍 Готово');
  });
});

describe('lib/bot renderTaskCardBody: Постановщик', () => {
  it('assignedByName передана → строка «✍️ Постановщик» есть', () => {
    const text = renderTaskCardBody(makeCard({ assignedByName: 'Пётр' }));
    expect(text).toContain('✍️ Постановщик: @Пётр');
  });

  it('assignedByName не передана (undefined) → строки нет (обратная совместимость)', () => {
    const text = renderTaskCardBody(makeCard());
    expect(text).not.toContain('Постановщик');
  });

  it('assignedByName = null → строка с «—»', () => {
    const text = renderTaskCardBody(makeCard({ assignedByName: null }));
    expect(text).toContain('✍️ Постановщик: —');
  });
});

describe('lib/bot renderTaskCardBody: Проверяющий (087)', () => {
  it('reviewerName есть → строка «🔍 Проверяющий» после Постановщика', () => {
    const text = renderTaskCardBody(
      makeCard({ assignedByName: 'Пётр', reviewerName: 'Анна' })
    );
    expect(text).toContain('🔍 Проверяющий: @Анна');
    expect(text.indexOf('✍️ Постановщик:')).toBeLessThan(
      text.indexOf('🔍 Проверяющий:')
    );
  });

  it('reviewerName = null → «🔍 Проверяющий: —» (единообразно с Постановщиком)', () => {
    const text = renderTaskCardBody(
      makeCard({ assignedByName: 'Пётр', reviewerName: null })
    );
    expect(text).toContain('🔍 Проверяющий: —');
  });

  it('reviewerName = "" (пустая строка) → тоже «—»', () => {
    const text = renderTaskCardBody(
      makeCard({ assignedByName: 'Пётр', reviewerName: '' })
    );
    expect(text).toContain('🔍 Проверяющий: —');
  });

  it('reviewerName не передана (undefined, старые caller-ы) → строки нет', () => {
    const text = renderTaskCardBody(makeCard({ assignedByName: 'Пётр' }));
    expect(text).not.toContain('Проверяющий');
  });
});
