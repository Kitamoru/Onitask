export type TaskLaunchTab = 'general' | 'comments';

export type StartParam =
  | {
      kind: 'task';
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

  const flowMatch = param.match(/^flow_([a-z0-9-]+)$/);
  if (flowMatch) return { kind: 'flow', slug: flowMatch[1] };

  // Reserved namespaces are not legacy invite codes.
  if (param.startsWith('task_') || param.startsWith('flow_')) return null;

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
