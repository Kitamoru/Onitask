// Tests for src/lib/reviewDecision.ts — REV-01 модель прав review-решения.
// Модель вынесена в отдельный чистый модуль чтобы unit-тестировать biz-rule
// в node-env (vitest) без jsdom/RTL.

import { describe, it, expect } from 'vitest';
import {
  canCurrentUserReview,
  isReviewDecision,
  isReviewBypassBlocked,
  isResultArtifact,
} from '../../src/lib/reviewDecision';
import type { TaskEntity } from '../../src/types/flowboard';

type ReviewTask = Pick<TaskEntity, 'column' | 'reviewer_id' | 'created_by'>;

const makeTask = (over: Partial<ReviewTask> = {}): ReviewTask =>
  ({ column: 'review', reviewer_id: null, created_by: null, ...over });

describe('canCurrentUserReview (REV-01)', () => {
  it('назначенный reviewer может решать', () => {
    expect(canCurrentUserReview(makeTask({ reviewer_id: 'r-1' }), 'r-1')).toBe(true);
  });

  it('не reviewer не может, если reviewer назначен (backfill-creator тоже нет)', () => {
    expect(canCurrentUserReview(makeTask({ reviewer_id: 'r-1', created_by: 'c-1' }), 'c-1')).toBe(
      false,
    );
  });

  it('creator может review, только если reviewer НЕ назначен (backfill)', () => {
    expect(canCurrentUserReview(makeTask({ reviewer_id: null, created_by: 'c-1' }), 'c-1')).toBe(
      true,
    );
  });

  it('admin/fors-mainj override — может решать чужую задачу в review', () => {
    expect(
      canCurrentUserReview(
        makeTask({ reviewer_id: 'r-other', created_by: 'c-other' }),
        'admin-id',
        'admin',
      ),
    ).toBe(true);
  });

  it('owner тоже форс-мейджит', () => {
    expect(
      canCurrentUserReview(
        makeTask({ reviewer_id: 'r-other', created_by: 'c-other' }),
        'owner-id',
        'owner',
      ),
    ).toBe(true);
  });

  it('отсутствие текущего пользователя → false', () => {
    expect(canCurrentUserReview(makeTask({ reviewer_id: 'r-1' }), undefined)).toBe(false);
  });

  it('null task → false', () => {
    expect(canCurrentUserReview(null, 'r-1')).toBe(false);
  });

  it('admin не решает задачу, НЕ в review', () => {
    expect(canCurrentUserReview(makeTask({ column: 'done', reviewer_id: 'r-1' }), 'admin', 'admin')).toBe(
      false,
    );
  });
});

// ── isReviewDecision: правило цианового бордера в ленте (083 fix / 086 approve) ──

type FeedItem = { kind: string; payload?: { source?: unknown } | null };

const makeItem = (over: Partial<FeedItem> = {}): FeedItem =>
  ({ kind: 'comment', payload: { source: 'twa' }, ...over });

describe('isReviewDecision (лента: циановый бордер ревью-решений)', () => {
  it('source=review → true (fix 083 и approve 086 пишут этим source)', () => {
    expect(isReviewDecision(makeItem({ payload: { source: 'review' } }))).toBe(true);
  });

  it('обычные комментарии twa / mcp / telegram / system → false', () => {
    for (const source of ['twa', 'mcp', 'telegram', 'system']) {
      expect(isReviewDecision(makeItem({ payload: { source } }))).toBe(false);
    }
  });

  it('source отсутствует / null → false', () => {
    expect(isReviewDecision(makeItem({ payload: null }))).toBe(false);
    expect(isReviewDecision(makeItem({ payload: {} }))).toBe(false);
  });

  it('не комментарий (activity/status) → false, даже с source=review', () => {
    expect(
      isReviewDecision(makeItem({ kind: 'activity', payload: { source: 'review' } })),
    ).toBe(false);
  });

  it('source не-строка приводится через String() → false', () => {
    expect(isReviewDecision(makeItem({ payload: { source: 42 } }))).toBe(false);
  });

  it('null/undefined item → false (без падений)', () => {
    expect(isReviewDecision(null)).toBe(false);
    expect(isReviewDecision(undefined)).toBe(false);
  });
});

// ─── isReviewDecision (083 fix / 086 approve) ───────────────────────────────

describe('isReviewDecision (083/086) — циановый бордер ревью-комментария', () => {
  const feedItem = (
    kind: string,
    source?: unknown,
  ): { kind: string; payload?: { source?: unknown } | null } => ({
    kind,
    payload: source === undefined ? null : { source },
  });

  it('fix-комментарий ревьюера (source=review, 083) → true', () => {
    expect(isReviewDecision(feedItem('comment', 'review'))).toBe(true);
  });

  it('approve-комментарий «результат согласован» (source=review, 086) → true', () => {
    expect(isReviewDecision(feedItem('comment', 'review'))).toBe(true);
  });

  it('обычные комментарии (twa/mcp/telegram/system) → false', () => {
    expect(isReviewDecision(feedItem('comment', 'twa'))).toBe(false);
    expect(isReviewDecision(feedItem('comment', 'mcp'))).toBe(false);
    expect(isReviewDecision(feedItem('comment', 'telegram'))).toBe(false);
    expect(isReviewDecision(feedItem('comment', 'system'))).toBe(false);
  });

  it('строки активности (status/agent) → false, даже если source совпал', () => {
    expect(isReviewDecision(feedItem('status', 'review'))).toBe(false);
    expect(isReviewDecision(feedItem('agent', 'review'))).toBe(false);
  });

  it('комментарий без payload / без source → false', () => {
    expect(isReviewDecision(feedItem('comment'))).toBe(false);
    expect(isReviewDecision(feedItem('comment', null))).toBe(false);
    expect(isReviewDecision({ kind: 'comment', payload: {} })).toBe(false);
  });

  it('null/undefined item → false (не падает)', () => {
    expect(isReviewDecision(null)).toBe(false);
    expect(isReviewDecision(undefined)).toBe(false);
  });

  it('нестроковый source приводится через String (число 0 → false)', () => {
    expect(isReviewDecision(feedItem('comment', 0))).toBe(false);
  });
});

// ─── isReviewBypassBlocked (REV-02): назначенного ревьюера нельзя обойти ─────
// Регресс на найденную дыру: старые гварды в route.ts / moveTask.ts / миграции
// 082 срабатывали только при `!reviewer_id`, поэтому исполнитель мог провести
// задачу с назначенным ревьюером прямо в «Сделано».

describe('isReviewBypassBlocked (REV-02) — обход назначенного ревьюера', () => {
  it('исполнитель (не ревьюер) НЕ может провести в done — blocked', () => {
    expect(
      isReviewBypassBlocked(
        { column: 'review', reviewer_id: 'r-1' },
        { workerId: 'assignee-1', role: 'member' },
      ),
    ).toBe(true);
  });

  it('автор задачи тоже blocked, если ревьюер назначен', () => {
    expect(
      isReviewBypassBlocked(
        { column: 'review', reviewer_id: 'r-1' },
        { workerId: 'creator-1', role: 'member' },
      ),
    ).toBe(true);
  });

  it('аноним (workerId=null/undefined) → blocked', () => {
    for (const workerId of [null, undefined]) {
      expect(
        isReviewBypassBlocked({ column: 'review', reviewer_id: 'r-1' }, { workerId, role: 'member' }),
      ).toBe(true);
    }
  });

  it('сам ревьюер может — это его решение', () => {
    expect(
      isReviewBypassBlocked(
        { column: 'review', reviewer_id: 'r-1' },
        { workerId: 'r-1', role: 'member' },
      ),
    ).toBe(false);
  });

  it('owner/admin форс-мейджит (сценарий «закрыть мимо ревьюера»)', () => {
    for (const role of ['owner', 'admin']) {
      expect(
        isReviewBypassBlocked(
          { column: 'review', reviewer_id: 'r-other' },
          { workerId: 'x-1', role },
        ),
      ).toBe(false);
    }
  });

  it('задача НЕ в review → false (правило про согласование не применяется)', () => {
    for (const column of ['backlog', 'in_progress', 'done']) {
      expect(
        isReviewBypassBlocked({ column, reviewer_id: 'r-1' }, { workerId: 'a-1', role: 'member' }),
      ).toBe(false);
    }
  });

  it('ревьюер НЕ назначен → false: прежнее поведение не меняем (см. комментарий в модуле)', () => {
    for (const reviewer_id of [null, undefined, '']) {
      expect(
        isReviewBypassBlocked({ column: 'review', reviewer_id }, { workerId: 'a-1', role: 'member' }),
      ).toBe(false);
    }
  });

  it('роль не задана (агент, role=null) → blocked, если агент не ревьюер', () => {
    expect(
      isReviewBypassBlocked(
        { column: 'review', reviewer_id: 'r-1' },
        { workerId: 'agent-1', role: null },
      ),
    ).toBe(true);
  });
});

// ─── isResultArtifact (REV-02): зелёный бордер итогового результата ──────────
// Отдельный предикат, потому что source='agent' занят под обычные реплики
// агента и details: покрасив его, мы бы позеленили лишнее.

describe('isResultArtifact (REV-02) — зелёный бордер итога', () => {
  const feedItem = (
    kind: string,
    source?: unknown,
  ): { kind: string; payload?: { source?: unknown } | null } => ({
    kind,
    payload: source === undefined ? null : { source },
  });

  it('source=result → true', () => {
    expect(isResultArtifact(feedItem('comment', 'result'))).toBe(true);
  });

  it('source=agent → false: details и обычные реплики агента не красим', () => {
    expect(isResultArtifact(feedItem('comment', 'agent'))).toBe(false);
  });

  it('остальные источники → false', () => {
    for (const source of ['twa', 'mcp', 'telegram', 'system', 'review', 'cron']) {
      expect(isResultArtifact(feedItem('comment', source))).toBe(false);
    }
  });

  it('не комментарий (status/activity) → false, даже с source=result', () => {
    expect(isResultArtifact(feedItem('status', 'result'))).toBe(false);
    expect(isResultArtifact(feedItem('activity', 'result'))).toBe(false);
  });

  it('нет payload / нет source / null / undefined → false', () => {
    expect(isResultArtifact(feedItem('comment'))).toBe(false);
    expect(isResultArtifact(feedItem('comment', null))).toBe(false);
    expect(isResultArtifact({ kind: 'comment', payload: {} })).toBe(false);
    expect(isResultArtifact(null)).toBe(false);
    expect(isResultArtifact(undefined)).toBe(false);
  });

  it('result НЕ подпадает под isReviewDecision — цвета не конфликтуют', () => {
    expect(isResultArtifact(feedItem('comment', 'result'))).toBe(true);
    expect(isReviewDecision(feedItem('comment', 'result'))).toBe(false);
  });
});
