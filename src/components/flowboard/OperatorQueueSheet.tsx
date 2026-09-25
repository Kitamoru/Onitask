'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card, SectionHeader } from '@/components/ui/desk-ui';
import { getEscalations, retryEscalation } from '@/lib/api/escalations';
import { formatEscalationAge } from '@/lib/escalations';
import type { EscalationQueueItem } from '@/types/escalations';

export interface OperatorQueueSheetProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onOpenTask: (taskId: string) => void;
  onRetried: (taskId: string, version: number, updatedAt: string) => void;
}

export function OperatorQueueSheet({ open, onClose, workspaceId, onOpenTask, onRetried }: OperatorQueueSheetProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['escalations', workspaceId] as const, [workspaceId]);
  const [retryItem, setRetryItem] = useState<EscalationQueueItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({
    queryKey,
    queryFn: () => getEscalations(workspaceId),
    enabled: open && Boolean(workspaceId),
    staleTime: 15_000,
  });
  const retryMutation = useMutation({
    mutationFn: retryEscalation,
    onSuccess: (result) => {
      onRetried(result.task_id, result.version, result.updated_at);
      setRetryItem(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Не удалось запустить задачу повторно');
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const items = query.data?.items ?? [];
  const isRetrying = (taskId: string) => retryMutation.isPending && retryMutation.variables === taskId;

  const handleOpenTask = (taskId: string) => {
    onClose();
    onOpenTask(taskId);
  };
  const confirmRetry = () => {
    if (retryItem?.can_retry) retryMutation.mutate(retryItem.id);
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <SectionHeader title={`Эскалации${items.length > 0 ? ` · ${items.length}` : ''}`} />
          {query.isLoading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />Загружаем эскалации
            </div>
          )}
          {query.isError && (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
              <p className="text-sm text-text-muted">Не удалось загрузить эскалации</p>
              <Button variant="outline" onClick={() => void query.refetch()}>Попробовать ещё раз</Button>
            </div>
          )}
          {query.isSuccess && items.length === 0 && (
            <Card notch={8}>
              <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                <p className="text-sm font-medium text-text">Нет задач, ожидающих решения</p>
                <p className="text-body-sm text-text-muted">Все задачи продолжают выполняться</p>
              </div>
            </Card>
          )}
          {items.map((item) => (
            <Card key={item.id} notch={8}>
              <article className="flex flex-col gap-3 p-4" aria-label={`Эскалация ${item.full_id}: ${item.title}`}>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs text-text-muted">{item.full_id}</span>
                  <h3 className="text-[15px] font-medium text-text">{item.title}</h3>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-text">◆ Агент «{item.agent_name || 'без имени'}»</span>
                  <span className="text-sm text-text-muted">Агент остановился и ждёт вашего решения.</span>
                  <span className="text-body-sm text-text-muted">Причина: {item.reason_label.toLocaleLowerCase('ru-RU')}</span>
                  <span className="text-body-sm text-text-muted">В ожидании {formatEscalationAge(item.hours_pending)}</span>
                </div>
                {item.suggested_action && <p className="rounded border border-line bg-surface px-3 py-2 text-body-sm text-text">{item.suggested_action}</p>}
                {(item.reason === 'max_attempts' || item.reason === 'unsupported_task') && (
                  <div className="flex flex-col gap-1 border-l-2 border-[var(--color-priority-amber-border)] pl-3">
                    {item.nack_reason && <p className="text-body-sm text-text-muted">Последняя попытка: {item.nack_reason}</p>}
                    {item.nack_detail && <p className="break-words text-body-sm text-text-muted">Детали: {item.nack_detail}</p>}
                  </div>
                )}
                {item.is_blocked && <p className="text-body-sm text-[var(--color-blocked-badge-text)]">Сначала проверьте связанные задачи</p>}
                {actionError && retryMutation.variables === item.id && <p className="text-body-sm text-[var(--color-priority-red-text)]" role="alert">{actionError}</p>}
                <Button variant="solid" disabled={!item.can_retry || retryMutation.isPending} onClick={() => { setActionError(null); setRetryItem(item); }}>
                  {isRetrying(item.id) && <Loader2 className="h-4 w-4 animate-spin" />}Попробовать снова
                </Button>
                <Button variant="outline" onClick={() => handleOpenTask(item.id)}>Открыть задачу</Button>
              </article>
            </Card>
          ))}
        </div>
      </BottomSheet>
      <BottomSheet
        open={Boolean(retryItem)}
        onClose={() => { if (!retryMutation.isPending) setRetryItem(null); }}
        stacked
      >
        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-[17px] font-semibold text-text">Попробовать задачу снова?</h3>
            <p className="text-sm leading-5 text-text-muted">
              Агент начнёт новый проход. История, комментарии и файлы сохранятся.
              Если причина не изменилась, агент может снова запросить помощь.
            </p>
          </div>
          {actionError && retryItem && (
            <p className="text-sm text-[var(--color-priority-red-text)]" role="alert">
              {actionError}
            </p>
          )}
          <Button
            variant="solid"
            disabled={retryMutation.isPending || !retryItem?.can_retry}
            onClick={confirmRetry}
          >
            {retryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Попробовать снова
          </Button>
          <Button
            variant="outline"
            disabled={retryMutation.isPending}
            onClick={() => setRetryItem(null)}
          >
            Отмена
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
