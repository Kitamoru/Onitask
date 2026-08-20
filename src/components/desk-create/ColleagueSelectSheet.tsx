'use client';

/**
 * ColleagueSelectSheet — bottom sheet for selecting multiple colleagues.
 *
 * Shows a list of available colleagues with checkbox-style selection.
 * Supports multi-select mode for bulk adding members to a new workspace.
 */

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui/Button';

export interface ColleagueItem {
  source_id: string;
  display_name: string;
}

export interface ColleagueSelectSheetProps {
  /** Whether the sheet is open */
  open: boolean;
  /** Callback when the sheet is closed */
  onClose: () => void;
  /** Available colleagues */
  colleagues: ColleagueItem[];
  /** Currently selected source_ids */
  selectedIds: Set<string>;
  /** Called when user toggles a colleague */
  onToggle: (sourceId: string) => void;
  /** Called when user confirms selection */
  onConfirm: () => void;
  /** Sheet title */
  title?: string;
  /** Render as a stacked portal (higher z-index, for overlaying another BottomSheet) */
  stacked?: boolean;
}

export function ColleagueSelectSheet({
  open,
  onClose,
  colleagues,
  selectedIds,
  onToggle,
  onConfirm,
  title = 'Выберите коллег',
  stacked = false,
}: ColleagueSelectSheetProps) {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} stacked={stacked}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* Title */}
        <h3 className="text-[17px] font-semibold text-text">{title}</h3>

        {/* Colleagues list */}
        {colleagues.length === 0 ? (
          <p className="text-sm text-text-secondary">Нет доступных участников</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {colleagues.map((c) => {
              const isSelected = selectedIds.has(c.source_id);
              return (
                <button
                  key={c.source_id}
                  type="button"
                  onClick={() => onToggle(c.source_id)}
                  className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-bg-secondary/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Checkbox indicator */}
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary'
                          : 'border-border'
                      }`}
                    >
                      {isSelected && (
                        <svg
                          width="12"
                          height="10"
                          viewBox="0 0 12 10"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M1 5L4.5 8.5L11 1.5"
                            stroke="white"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                    {/* Name */}
                    <span className="truncate text-[15px] font-medium text-text">
                      {c.display_name}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Confirm button */}
        <Button
          variant="solid"
          onClick={handleConfirm}
          disabled={selectedIds.size === 0}
          className="w-full"
        >
          Готово
        </Button>
      </div>
    </BottomSheet>
  );
}