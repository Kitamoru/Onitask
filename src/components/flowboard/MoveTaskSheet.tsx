'use client';

/**
 * MoveTaskSheet — bottom sheet for moving a task between Kanban columns.
 *
 * Reuses the visual language of ColleagueSelectSheet (BottomSheet + selectable
 * rows + confirm button) but adapted for single-select, column-based move:
 *
 *  - 4 column blocks: В очереди / В работе / На проверке / Сделано
 *  - Circle per row coloured with the column accent (COLUMN_ACCENTS)
 *  - Active target column: white border around the row + white dot inside circle
 *  - Confirm button: amber solid, labeled "Переместить в → <target>"
 *    (disabled while the selected column equals the task's current column)
 *
 * Haptics (Telegram Web App) are used when available and no-op otherwise.
 */

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui';
import { COLUMN_ACCENTS } from '@/components/flowboard/ColumnTasksSheet';
import type { TaskEntity } from '@/types/flowboard';

/** Column order matches the FlowBoard Kanban order. */
export const MOVE_COLUMN_ORDER: string[] = ['backlog', 'in_progress', 'review', 'done'];

/** Localized column labels tuned for the move sheet. */
const MOVE_COLUMN_LABELS: Record<string, string> = {
  backlog: 'В очереди',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Сделано',
};

export interface MoveTaskSheetProps {
  /** Whether the sheet is open */
  open: boolean;
  /** Callback when the sheet is closed (cancel / backdrop / swipe) */
  onClose: () => void;
  /** The task being moved (header context); null while no task is selected yet */
  task?: Partial<TaskEntity> | null;
  /** Column the task currently sits in — cannot confirm a move to itself */
  currentColumn: string;
  /** Currently selected target column */
  selectedColumn: string;
  /** Called when user picks a different column */
  onSelect: (column: string) => void;
  /** Called when user confirms the move */
  onConfirm: (targetColumn: string) => void;
}

/** Safe, no-op haptic helpers — mirror useTelegramAuth.triggerHaptic surface. */
function selectionHaptic() {
  void (window as any).Telegram?.WebApp?.HapticFeedback?.selectionChanged();
}
function successHaptic() {
  void (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success') as void;
}

export function MoveTaskSheet({
  open,
  onClose,
  task,
  currentColumn,
  selectedColumn,
  onSelect,
  onConfirm,
}: MoveTaskSheetProps) {
  // Invariant: no task selected yet → render nothing (the sheet mounts before a task is picked)
  if (!task) return null;

  const columns = MOVE_COLUMN_ORDER;
  const isSameAsTarget = selectedColumn === currentColumn;

  const handleConfirm = () => {
    successHaptic();
    onConfirm(selectedColumn);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} stacked>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* Header — task context (full_id + title) */}
        <div className="flex flex-col gap-1">
          <h3 className="text-[17px] font-semibold text-text">Переместить задачу</h3>
          {/* Number on its own line, full title below — no truncation */}
          <span className="font-mono text-sm font-medium text-text-secondary">
            {task.full_id}
          </span>
          <p className="text-sm font-medium leading-snug text-text">
            {`· ${task.title ?? ''}`}
          </p>
        </div>

        {/* Column selector blocks */}
        <div className="flex flex-col gap-2 pt-1">
          {columns.map((col) => {
            const isActive = selectedColumn === col;
            const color = COLUMN_ACCENTS[col] ?? COLUMN_ACCENTS.in_progress;
            const label = MOVE_COLUMN_LABELS[col] ?? col;
            return (
              <button
                key={col}
                type="button"
                onClick={() => {
                  selectionHaptic();
                  onSelect(col);
                }}
                className={`w-full cursor-pointer rounded-lg border-2 bg-transparent p-3 text-left transition-colors ${
                  isActive
                    ? 'border-white'
                    : 'border-line hover:border-white/30'
                }`}
                aria-pressed={isActive}
              >
                <div className="flex items-center gap-3">
                  {/* Colour dot with optional white selection ring + inner dot */}
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                    <span
                      className="h-6 w-6 rounded-full border-2"
                      style={{
                        backgroundColor: color,
                        borderColor: isActive ? 'white' : 'transparent',
                      }}
                      aria-hidden="true"
                    />
                    {isActive && (
                      <span
                        className="absolute h-2.5 w-2.5 rounded-full bg-white"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span className="truncate text-[15px] font-medium text-text">
                    {label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Confirm — amber solid, labeled with the target column */}
        <Button
          variant="solid"
          onClick={handleConfirm}
          disabled={isSameAsTarget}
          className="w-full"
        >
          {`Переместить → ${MOVE_COLUMN_LABELS[selectedColumn] ?? selectedColumn}`}
        </Button>
      </div>
    </BottomSheet>
  );
}
