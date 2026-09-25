// Регрессия: фримиум-гейт блокировал /task при ЛЮБОМ тарифе.
//
// checkFreemiumBoundary вызывался со строкой 'create-task', которой нет
// ни в одном списке PLAN_COMMANDS (там канонические имена 'task'/'backlog').
// isCommandAvailable возвращала false всегда, включая team, и бот отвечал
// paywall-сообщением вместо создания задачи.
import { describe, it, expect, vi } from 'vitest';

// freemium.ts создаёт Supabase-клиент на уровне модуля, а тесту нужна
// только чистая функция isCommandAvailable. Мок обязателен: без
// NEXT_PUBLIC_SUPABASE_URL модуль падает на этапе импорта.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => undefined }) }),
    }),
  }),
}));

import { isCommandAvailable } from '../../src/lib/bot/freemium';
import type { PlanType } from '../../src/lib/bot/freemium';

const PLANS: PlanType[] = ['free', 'solo', 'ai_dev', 'team'];

describe('freemium: гейт не должен блокировать бота', () => {
  it.each(PLANS)('/task доступен на тарифе %s', (plan) => {
    expect(isCommandAvailable('task', plan)).toBe(true);
  });

  it.each(PLANS)('/backlog доступен на тарифе %s', (plan) => {
    expect(isCommandAvailable('backlog', plan)).toBe(true);
  });

  it.each(PLANS)('/help доступен на тарифе %s', (plan) => {
    expect(isCommandAvailable('help', plan)).toBe(true);
  });

  it('старое имя create-task больше не используется вызывающей стороной', () => {
    // Если бы гейт снова начали звать с 'create-task', он бы заблокировал
    // всё. Ключи в PLAN_COMMANDS и на вызове должны совпадать.
    expect(isCommandAvailable('create-task', 'team')).toBe(false);
  });

  it('неизвестная команда не проходит ни на одном тарифе', () => {
    for (const plan of PLANS) {
      expect(isCommandAvailable('standup', plan)).toBe(false);
      expect(isCommandAvailable('', plan)).toBe(false);
    }
  });
});
