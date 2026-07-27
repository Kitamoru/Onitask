"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";

export function SprintActivationCard({
  enabled,
  onEnabledChange,
  disabled = false,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Активировать спринт
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Активировать спринт"
          disabled={disabled}
        />
      </div>
    </Card>
  );
}