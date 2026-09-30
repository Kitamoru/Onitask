// Tests for needsBoardCreation — условие показа онбординга.
//
// Онбординг обязан зависеть от СОСТОЯНИЯ (нет досок), а не от флага
// is_new_user: тот истинно только в запросе, создавшем профиль, поэтому
// прерванный онбординг раньше не возвращался.
//
// Тесты вызывают функцию (чистую, без модулей), а не ищут её текст в
// исходниках: grep-тест остался бы зелёным при выключенной фиче.

import { describe, it, expect } from 'vitest';
import { needsBoardCreation } from '../../src/lib/onboarding';
import type { InitResponse } from '../../types/api';

function makeInit(overrides: Partial<InitResponse> = {}): InitResponse {
  return {
    worker: { id: 'w1', display_name: 'Test', workspace_id: '', role: null },
    profile_id: 'p1',
    workspaces: [],
    is_new_user: false,
    last_active_workspace_id: null,
    ...overrides,
  } as InitResponse;
}

describe('needsBoardCreation', () => {
  it('нет досок → нужен онбординг (свежий профиль)', () => {
    expect(needsBoardCreation(makeInit({ is_new_user: true }))).toBe(true);
  });

  // Главный регресс: профиль УЖЕ создан (is_new_user=false), но досок нет.
  // Именно это состояние раньше отправляло нового пользователя на пустую
  // доску вместо формы — навсегда.
  it('профиль есть, досок нет → онбординг показывается СНОВА', () => {
    expect(needsBoardCreation(makeInit({ is_new_user: false }))).toBe(true);
  });

  it('есть хотя бы одна доска → онбординг не нужен', () => {
    const data = makeInit({
      is_new_user: false,
      workspaces: [
        { id: 'ws1', name: 'Команда', slug: 'team', task_prefix: 'TEAM', role: 'owner' },
      ],
    });
    expect(needsBoardCreation(data)).toBe(false);
  });

  // Инвайт: /api/init отдаёт workspaces: [{ id, name: '', slug: '' }].
  // Приглашённому пользователю онбординг показывать нельзя.
  it('инвайт (доска с пустыми name/slug) → онбординг не нужен', () => {
    const data = makeInit({
      is_new_user: false,
      workspaces: [
        { id: 'ws1', name: '', slug: '', task_prefix: '', role: 'member' },
      ],
    });
    expect(needsBoardCreation(data)).toBe(false);
  });

  it('is_new_user не влияет на результат — решает только число досок', () => {
    const withBoard = (is_new_user: boolean) =>
      makeInit({
        is_new_user,
        workspaces: [
          { id: 'ws1', name: 'A', slug: 'a', task_prefix: 'A', role: 'owner' },
        ],
      });
    const withoutBoard = (is_new_user: boolean) => makeInit({ is_new_user });

    expect(needsBoardCreation(withBoard(true))).toBe(needsBoardCreation(withBoard(false)));
    expect(needsBoardCreation(withoutBoard(true))).toBe(needsBoardCreation(withoutBoard(false)));
  });

  it('null/undefined (auth ещё грузится или ошибка) → false, чтобы не было редиректа', () => {
    expect(needsBoardCreation(null)).toBe(false);
    expect(needsBoardCreation(undefined)).toBe(false);
  });
});
