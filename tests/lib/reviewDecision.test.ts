// Tests for src/lib/reviewDecision.ts — REV-01 модель прав review-решения.
// Модель вынесена в отдельный чистый модуль чтобы unit-тестировать biz-rule
// в node-env (vitest) без jsdom/RTL.

import { describe, it, expect } from 'vitest';
import { canCurrentUserReview } from '../../src/lib/reviewDecision';
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
