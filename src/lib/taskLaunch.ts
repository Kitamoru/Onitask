export type TaskLaunchTab = 'general' | 'comments';

export type StartParam =
  | {
      kind: 'task';
      fullId: string;
      tab: TaskLaunchTab;
    }
  | {
      /**
       * SUB-01: подзадача. Отдельный namespace, а не хвост в `task_`, потому
       * что `task_` должен означать САМОСТОЯТЕЛЬНУЮ задачу: иначе ссылка на
       * подзадачу и ссылка на родителя выглядели бы одинаково, и UI не смог бы
       * показать «Ваша подзадача» внутри задачи-родителя.
       */
      kind: 'subtask';
      fullId: string;
      tab: TaskLaunchTab;
    }
  | {
      kind: 'flow';
      slug: string;
    }
  | {
      kind: 'invite';
      code: string;
    };

export type TaskLaunchTarget = {
  kind: 'task';
  taskId: string;
  workspaceId: string;
  workspaceSlug: string;
  fullId: string;
  tab: TaskLaunchTab;
  /**
   * SUB-01: заполняется, если `find_task_by_full_id` нашёл ПОДЗАДАЧУ.
   * Подзадачи нет на доске (миграции 140/141), поэтому TWA открывает карточку
   * РОДИТЕЛЯ и подсвечивает подзадачу внутри — иначе deep link вёл бы в пустоту.
   */
  parentTaskId?: string | null;
  subtaskId?: string | null;
};

/** Parse Telegram start_param without performing navigation or authorization. */
export function parseStartParam(param: string | null | undefined): StartParam | null {
  if (!param) return null;

  const taskMatch = param.match(/^task_([A-Za-z]+-\d+)(_comments)?$/);
  if (taskMatch) {
    return {
      kind: 'task',
      fullId: taskMatch[1].toUpperCase(),
      tab: taskMatch[2] ? 'comments' : 'general',
    };
  }

  // SUB-01: «ONI-42-SUB-1». Регулярка task_ выше сюда не дотягивается — там
  // ровно [\w]+-\d+, а тут ещё хвост «-SUB-1».
  const subtaskMatch = param.match(/^subtask_([A-Za-z]+-\d+-SUB-\d+)(_comments)?$/);
  if (subtaskMatch) {
    return {
      kind: 'subtask',
      fullId: subtaskMatch[1].toUpperCase(),
      tab: subtaskMatch[2] ? 'comments' : 'general',
    };
  }

  const flowMatch = param.match(/^flow_([a-z0-9-]+)$/);
  if (flowMatch) return { kind: 'flow', slug: flowMatch[1] };

  // Reserved namespaces are not legacy invite codes.
  if (
    param.startsWith('task_') ||
    param.startsWith('subtask_') ||
    param.startsWith('flow_')
  ) {
    return null;
  }

  // Legacy invite links are opaque base64url codes. New links may use invite_*,
  // but accepting the old shape keeps already distributed Telegram links alive.
  const code = param.startsWith('invite_') ? param.slice(7) : param;
  return /^[A-Za-z0-9_-]+$/.test(code) ? { kind: 'invite', code } : null;
}

export function inviteDeepLink(
  code: string,
  baseUrl = 'https://t.me/onitaskbot/onitask',
): string {
  return `${baseUrl}?startapp=invite_${code}`;
}
