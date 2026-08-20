"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { CountBadge } from "@/components/ui/desk-ui/CountBadge";
import { Button } from "@/components/ui/desk-ui/Button";
import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import type { ColleagueItem } from "./ColleagueSelectSheet";

// Re-export for consumers
export type { ColleagueItem };

export interface CoworkingSectionProps {
  /** Total available colleagues from owner workspaces */
  availableCount: number;
  /** Currently selected colleagues to add */
  selectedColleagues: ColleagueItem[];
  /** Callback to open the colleague selection sheet */
  onOpenSelect: () => void;
  /** Whether the form is submitting (disable interactions) */
  disabled?: boolean;
  /** Read-only mode — hide controls */
  readOnly?: boolean;
}

export function CoworkingSection({
  availableCount,
  selectedColleagues,
  onOpenSelect,
  disabled = false,
  readOnly = false,
}: CoworkingSectionProps) {
  // Badge shows count of SELECTED colleagues (the ones being added to new board)
  const badgeCount = selectedColleagues.length;

  return (
    <section>
      <SectionHeader title="Коворкинг" />
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[15px] font-medium text-text">
            Список коллег
          </span>
          <CountBadge>
            {badgeCount > 0 ? `${badgeCount} выбрано` : `${availableCount} доступно`}
          </CountBadge>
        </div>

        {/* Selected colleagues list preview */}
        {selectedColleagues.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {selectedColleagues.map((c) => (
              <div
                key={c.source_id}
                className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-white">
                  {c.display_name.charAt(0).toUpperCase()}
                </div>
                <span className="truncate text-[14px] font-medium text-text">
                  {c.display_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {!readOnly && (
          <Button variant="outline" onClick={onOpenSelect} disabled={disabled}>
            {selectedColleagues.length > 0
              ? `Изменить (${selectedColleagues.length})`
              : 'Добавить коллегу'}
          </Button>
        )}
      </Card>
    </section>
  );
}
