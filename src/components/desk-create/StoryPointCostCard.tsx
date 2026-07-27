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
  disabled = false,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  hoursBySp: Record<(typeof SP_VALUES)[number], string>;
  onHoursChange: (sp: (typeof SP_VALUES)[number], value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Стоимость сторипоинта
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Стоимость сторипоинта"
          disabled={disabled}
        />
      </div>
      <p className="mb-4 text-[13px] leading-[1.45] text-text-muted">
        По умолчанию сложность задачи считается в часах. Если ваша команда считает задачи в SP, активируйте переключатель. В появившейся форме укажите приблизительные значения SP в часах.
      </p>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          enabled
            ? "max-h-[600px] opacity-100"
            : "max-h-0 opacity-0"
        }`}
      >
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
                disabled={disabled || !enabled}
                inputMode="text"
              />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}