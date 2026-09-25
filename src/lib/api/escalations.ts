import type {
  EscalationsResponse,
  RetryEscalationResponse,
} from '@/types/escalations';
import { escalationReasonLabel, escalationSummary } from '@/lib/escalations';

function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return '';
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  }
  return fallback;
}

export async function getEscalations(workspaceId: string): Promise<EscalationsResponse> {
  return getEscalationQueue(`/api/tasks/escalations?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export async function getAllEscalations(): Promise<EscalationsResponse> {
  return getEscalationQueue('/api/tasks/escalations?scope=all');
}

async function getEscalationQueue(url: string): Promise<EscalationsResponse> {
  const initData = getTelegramInitData();
  const response = await fetch(url, { headers: { 'x-init-data': initData } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Не удалось загрузить эскалации'));
  }
  return payload as EscalationsResponse;
}

export async function retryEscalation(taskId: string): Promise<RetryEscalationResponse> {
  const initData = getTelegramInitData();
  const response = await fetch(
    `/api/tasks/${encodeURIComponent(taskId)}/escalations/retry`,
    {
      method: 'POST',
      headers: { 'x-init-data': initData },
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, 'Не удалось запустить задачу повторно'));
  }
  return payload as RetryEscalationResponse;
}

export { escalationReasonLabel, escalationSummary };
