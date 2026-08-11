'use client';

/**
 * WorkerSelectSheet — bottom sheet for selecting a task worker.
 *
 * Shows a list of available workers with radio-style selection.
 * Supports single-select mode (for assigned_to / reviewer_id).
 * Allows clearing the current selection.
 */

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Card } from '@/components/ui/desk-ui';
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
}

export function WorkerSelectSheet({
  open,
  onClose,
  workers,
  selectedId,
  onSelect,
  title = 'Выберите участника',
}: WorkerSelectSheetProps) {
  const handleSelect = (id: string) => {
    if (selectedId === id) {
      // Deselect if already selected
      onSelect(null);
    } else {
      onSelect(id);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* Title */}
        <h3 className="text-[17px] font-semibold text-text">{title}</h3>

        {/* Workers list */}
        {workers.length === 0 ? (
          <p className="text-sm text-text-secondary">Нет доступных участников</p>
        ) : (
          <div className="flex flex-col gap-2">
            {workers.map((w) => {
              const isSelected = w.id === selectedId;
              return (
                <Button
                  key={w.id}
                  variant={isSelected ? 'solid' : 'outline'}
                  onClick={() => handleSelect(w.id)}
                  className={`w-full justify-between ${isSelected ? 'ring-2 ring-primary' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-secondary"
                      aria-hidden="true"
                    >
                      {w.avatarUrl ? (
                        <img
                          src={w.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-text-secondary">
                          {w.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {/* Name */}
                    <span className="truncate text-[15px] font-medium text-text">
                      {w.displayName}
                    </span>
                  </div>
                  {/* Checkmark */}
                  {isSelected && (
                    <span className="text-lg text-primary">✓</span>
                  )}
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