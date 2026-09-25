'use client';

/**
 * WorkerSelectSheet — bottom sheet for selecting a task worker.
 *
 * Shows a list of available workers with radio-style selection.
 * Supports single-select mode (for assigned_to / reviewer_id).
 * Allows clearing the current selection.
 */

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card, SectionHeader } from '@/components/ui/desk-ui';
import type { WorkerCardData } from '@/types/flowboard';

export interface WorkerSelectSheetProps {
  /** Whether the sheet is open */
  open: boolean;
  /** Callback when the sheet is closed */
  onClose: () => void;
  /** Available workers */
  workers: WorkerCardData[];
  /** Currently selected worker ID (null = none) */
  selectedId: string | null;
  /** Called when user selects or clears a worker */
  onSelect: (workerId: string | null) => void;
  /** Sheet title */
  title?: string;
  /** Render as a stacked portal (higher z-index, for overlaying another BottomSheet) */
  stacked?: boolean;
  /** Show A-11 pre-flight confirmation before assigning a task */
  preflightEnabled?: boolean;
  /** Cognitive weight of the task being assigned */
  assignmentTaskWeight?: number;
}

export function shouldConfirmAssignment(worker: WorkerCardData, enabled = true): boolean {
  return enabled && (worker.attentionRiskScore ?? 0) >= 60;
}

export function WorkerSelectSheet({
  open,
  onClose,
  workers,
  selectedId,
  onSelect,
  title = 'Выберите участника',
  stacked = false,
  preflightEnabled = false,
  assignmentTaskWeight = 1,
}: WorkerSelectSheetProps) {
  const [pendingWorker, setPendingWorker] = useState<WorkerCardData | null>(null);
  useEffect(() => {
    if (!open) setPendingWorker(null);
  }, [open]);
  const handleSelect = (id: string) => {
    const worker = workers.find((item) => item.id === id);
    if (preflightEnabled && worker && shouldConfirmAssignment(worker)) {
      setPendingWorker(worker);
      return;
    }
    onSelect(id);
    onClose();
  };

  const confirmPending = () => {
    if (!pendingWorker) return;
    onSelect(pendingWorker.id);
    setPendingWorker(null);
    onClose();
  };

  const orderedWorkers = [...workers].sort(
    (a, b) => Number(a.type === 'agent') - Number(b.type === 'agent')
  );

  return (
    <BottomSheet open={open} onClose={onClose} stacked={stacked}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* Title */}
        <h3 className="text-[17px] font-semibold text-text">{title}</h3>

        {pendingWorker && (
          <Card notch={8}>
            <div className="flex flex-col gap-3">
              <SectionHeader title={`Назначить на ${pendingWorker.displayName}?`} />
              <p className="text-sm text-text-muted">
                Когнитивная нагрузка сейчас: {pendingWorker.cognitiveWeight}/3. Вес новой задачи: {assignmentTaskWeight}.
              </p>
              <p className="text-sm text-text-muted">
                Риск назначения: {pendingWorker.attentionRiskScore ?? 0}/100 · {pendingWorker.attentionRiskLevel ?? 'ok'}.
              </p>
              <div className="flex flex-col gap-2">
                <Button variant="solid" onClick={confirmPending}>
                  Назначить
                </Button>
                <Button variant="outline" onClick={() => setPendingWorker(null)}>
                  Выбрать другого
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Workers list */}
        {orderedWorkers.length === 0 ? (
          <p className="text-sm text-text-secondary">Нет доступных участников</p>
        ) : (
          <div className="flex flex-col gap-2">
            {orderedWorkers.map((w) => {
              const roleTitle = w.type === 'agent' ? 'AI-агент' : w.roleTitle?.trim() || null;

              return (
                <Button
                  key={w.id}
                  variant="outline"
                  onClick={() => handleSelect(w.id)}
                  className="w-full"
                  aria-label={`${w.displayName}${roleTitle ? `, ${roleTitle}` : ''}`}
                >
                  <div className="flex w-full items-center justify-between gap-3 px-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {/* Avatar */}
                      <div
                        className="bg-bg-secondary flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full"
                        aria-hidden="true"
                      >
                        {w.avatarUrl ? (
                          <img src={w.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-sm font-medium text-text-secondary">
                            {w.displayName.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="truncate text-[15px] font-medium text-text">
                        {w.displayName}
                      </span>
                    </div>
                    {roleTitle && (
                      <span className="max-w-[45%] shrink-0 truncate text-xs font-normal text-text-secondary">
                        {roleTitle}
                      </span>
                    )}
                  </div>
                </Button>
              );
            })}
          </div>
        )}

        {/* Clear button */}
        {selectedId && (
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onClose();
            }}
            className="w-full rounded px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            Убрать выбранного
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
