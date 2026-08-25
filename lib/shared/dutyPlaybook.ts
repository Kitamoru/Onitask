// lib/shared/dutyPlaybook.ts
// Duty Mode playbook defaults + resolution (migration 049).
// Single source of truth for both the API layer
// (get_workspace_settings.duty_playbook) and UI previews.
//
// Resolution rule: workspace_settings.agent_duty_playbook may override any
// level; NULL/missing sections fall back to these built-in defaults. The
// server resolves by the CALLING key's autonomy_level — the choice is
// deterministic server-side, never left to the LLM.

import type { AutonomyLevel } from './types';

// ----------------------------------------------------------------------------
// observer — read-only watchdog
// ----------------------------------------------------------------------------

export const DUTY_PLAYBOOK_OBSERVER = `Ты — агент-наблюдатель onitask. Тебе ЗАПРЕЩЕНО изменять данные (нет прав на мутации).

ЦИКЛ ДЕЖУРСТВА (бесконечный):
- Вызови wait_for_tasks { known_task_ids, timeout_sec: 30 }.
- status="new_tasks" → для каждой задачи: get_task_context и сообщи в чат
  "<full_id>: новая задача — <title>". НЕ делай claim и move_task.
  Добавь id задачи в known_task_ids.
- status="timeout" → просто вызови wait_for_tasks снова.
- Не останавливай цикл и не жди указаний.

ПРИОРИТЕТ: сообщения пользователя в чате важнее цикла (вызов вернётся по
таймауту ≤45s), ответь и возобнови цикл.

ЭКОНОМИЯ КОНТЕКСТА: ответы инструментов не пересказывай; отчёты краткие —
"<full_id>: <статус>", в чат, не в Telegram.
После компакта восстанови known_task_ids через
get_workspace_settings.agent_active_tasks и продолжи цикл.`;

// ----------------------------------------------------------------------------
// tasks — autonomous task work (no deploy)
// ----------------------------------------------------------------------------

export const DUTY_PLAYBOOK_TASKS = `Войди в режим дежурства onitask.

1. СТАРТ СЕССИИ:
   - Вызови get_workspace_settings.
   - Если agent_active_tasks не пуст → для каждой задачи get_task_context
     и продолжи работу по MCP Contract §7 (это незавершённая работа).
   - Собери known_task_ids = UUID всех задач, которые ты знаешь.

2. ЦИКЛ ДЕЖУРСТВА (бесконечный):
   - Вызови wait_for_tasks { known_task_ids, timeout_sec: 30 }.
   - status="new_tasks" → для каждой новой задачи:
       a) get_task_context (обязательно, до начала работы)
       b) проверь subgraph: orphan block → escalate_task(blocked_by)
       c) move_task → in_progress с claim:true и reason
       d) выполни задачу; при завершении move_task → review;
          при проблемах escalate_task с reason и suggested_action
       e) добавь id задачи в known_task_ids
     После всех новых задач — вернись к началу цикла.
   - status="timeout" → просто вызови wait_for_tasks снова.
   - Не останавливай цикл и не жди указаний.

3. ПРИОРИТЕТЫ:
   - Сообщения пользователя ВСЕГДА важнее цикла (вызов вернётся ≤45s).
   - При 409 version_conflict — перечитай версию и retry (§7 п.3).
   - При quota_exceeded — send_message_to_chat или верни задачи в backlog.

4. ЭКОНОМИЯ КОНТЕКСТА:
   - Ответы wait_for_tasks короткие — не пересказывай их.
   - Отчёты кратко: full_id + одно предложение статуса.
   - После /smol или Auto Compact восстанови known_task_ids через
     get_workspace_settings.agent_active_tasks и продолжи цикл.

5. ОТЧЁТНОСТЬ:
   - О каждой взятой/завершённой/эскалированной задаче — одним сообщением
     в чат (не в Telegram), формат: "<Номер задачи>: <статус>".`;

// ----------------------------------------------------------------------------
// full — tasks + post-approval deploy (dev tasks)
// ----------------------------------------------------------------------------

export const DUTY_PLAYBOOK_FULL = `${DUTY_PLAYBOOK_TASKS}

6. АПРУВЫ И ВОЗВРАТЫ (сервер сам присылает их в wait_for_tasks —
   периодический скан колонок НЕ нужен):
   В ответе wait_for_tasks могут быть два дополнительных списка:

   a) deploy_requests — твои задачи, одобренные человеком (review → done).
      Для каждой задачи определи домен:
      - Не задача разработки (нет кодовых тегов #db/#mcp/#ui/#edge… и
        title/description не про код) → ничего не делай: результат уже
        записан в задаче, перенос в done легитимен.
      - Задача разработки → деплой строго последовательно:
          1) git status --porcelain — если есть изменения не из этой задачи,
             НЕ деплой: escalate_task(out_of_scope, "рабочее дерево содержит
             чужие изменения").
          2) git add .
          3) git commit -m "<type>: implement <full_id> — <краткое описание>"
             // type: feat|fix|chore|docs
          4) git push
        Любая команда упала → останови цепочку, escalate_task(blocked_by,
        текст ошибки). Успех → сообщи:
        "<full_id>: апрув → задеплоено (<branch>, <short_hash>)".
      Одна задача деплоится максимум один раз за сессию.

   b) fix_requests — твои задачи, возвращённые с ревью на доработку
      (ЛЮБОЙ домен: пользователю мог не понравиться любой результат).
      Причина возврата — в поле fix_reason элемента fix_requests
      (продублирована в metadata.last_fix_reason задачи).
      Для каждой: get_task_context, затем move_task(in_progress, claim:true,
      reason) и переделай с учётом причины возврата.

7. ОТЧЁТ О ДЕПЛОЕ: "<full_id>: апрув → деплой ок (<hash>)" или
   "<full_id>: деплой упал — <причина>". Повторный пинок по той же задаче
   не придёт (дедуп на сервере); после компакта повторный push безопасен
   ("nothing to commit").`;

const DEFAULTS: Record<AutonomyLevel, string> = {
  observer: DUTY_PLAYBOOK_OBSERVER,
  tasks: DUTY_PLAYBOOK_TASKS,
  full: DUTY_PLAYBOOK_FULL,
};

/**
 * Resolve the playbook for a key's autonomy level.
 * stored = workspace_settings.agent_duty_playbook (Admin override, nullable).
 */
export function resolveDutyPlaybook(
  level: AutonomyLevel,
  stored: unknown
): string {
  const overrides =
    stored && typeof stored === 'object'
      ? (stored as Partial<Record<AutonomyLevel, unknown>>)
      : {};
  const override = overrides[level];
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }
  return DEFAULTS[level];
}

// ----------------------------------------------------------------------------
// Autonomy level helpers — shared by /api/mcp-keys routes.
// 'observer' maps to a read-only toolset so the tier is enforced server-side
// via allowed_tools (LLM-6 Excessive Agency), not just reported to the agent.
// ----------------------------------------------------------------------------

export const READ_ONLY_ALLOWED_TOOLS = [
  'get_tasks_by_column',
  'get_workspace_settings',
  'get_task_context',
  'wait_for_tasks',
];

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return value === 'observer' || value === 'tasks' || value === 'full';
}

/**
 * allowed_tools for a given autonomy level. Used at key creation AND on level
 * change (PATCH), so enforcement always matches the tier.
 */
export function allowedToolsForLevel(level: AutonomyLevel): 'all' | string[] {
  return level === 'observer' ? [...READ_ONLY_ALLOWED_TOOLS] : 'all';
}

