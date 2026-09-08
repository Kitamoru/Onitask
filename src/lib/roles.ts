/**
 * Роли и пресеты доступов доски.
 *
 * Два разных понятия:
 *  - Пресет доступов  → workers.role (owner/admin/member) — что можно делать на доске.
 *  - Роль в доске     → workers.role_title (кастомный текст: «Маркетолог», «Фронтендер»).
 *
 * UI показывает пресеты ТОЛЬКО полными лейблами («Владелец доски»), чтобы
 * селект читался как доступы, а не как должность.
 */

/** Пресеты доступов, выводимые в UI (viewer из CHECK-констрейнта в UI не показываем). */
export const PRESET_LABELS: Record<string, string> = {
  owner: 'Владелец доски',
  admin: 'Администратор доски',
  member: 'Участник доски',
};

/** Пресеты, доступные для выбора в селекте (owner выдаётся/снимается только владельцем — вне скоупа). */
export const EDITABLE_PRESETS: Array<'admin' | 'member'> = ['admin', 'member'];

/** Что даёт пресет (соответствует реальным RLS-возможностям). */
export const PRESET_DESCRIPTIONS: Record<string, string> = {
  owner: 'Полный доступ к доске: команда, приглашения, настройки, спринты и задачи.',
  admin: 'Управление командой, приглашениями, спринтами и настройками доски.',
  member: 'Работа с задачами: создание, перемещение, комментарии.',
};

/**
 * Формат отображения: «Пресет · Роль» → «Администратор доски · Маркетолог».
 * Без должности — просто пресет. Агентов вызывающий код обрабатывает отдельно.
 */
export function formatWorkerRole(role?: string | null, roleTitle?: string | null): string {
  const preset = PRESET_LABELS[role ?? ''] ?? PRESET_LABELS.member;
  const title = roleTitle?.trim();
  return title ? `${preset} · ${title}` : preset;
}
