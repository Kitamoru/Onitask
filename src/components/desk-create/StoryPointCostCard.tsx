"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { TextInput } from "@/components/ui/desk-ui/TextInput";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";

const SP_VALUES = [1, 3, 5, 7, 13] as const;

export function StoryPointCostCard({
  enabled,
  onEnabledChange,
  hoursBySp,
  onHoursChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  hoursBySp: Record<(typeof SP_VALUES)[number], string>;
  onHoursChange: (sp: (typeof SP_VALUES)[number], value: string) => void;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Стоимость сторипоинта
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Стоимость сторипоинта"
        />
      </div>

      <div className="flex flex-col gap-3">
        {SP_VALUES.map((sp) => (
          <div key={sp}>
            <label className="mb-1 block text-[13px] text-text">
              {sp} SP
            </label>
            <TextInput
              value={hoursBySp[sp]}
              onChange={(e) => onHoursChange(sp, e.target.value)}
              placeholder="1 час"
              disabled={!enabled}
              inputMode="text"
            />
          </div>
        ))}
      </div>
    </Card>
  );
}