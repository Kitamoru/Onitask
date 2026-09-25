"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { TextInput } from "@/components/ui/desk-ui/TextInput";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import { DEFAULT_STORY_POINT_VALUES } from "@/lib/storyPoints";

export function StoryPointCostCard({
  enabled,
  onEnabledChange,
  hoursBySp,
  onHoursChange,
  disabled = false,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  hoursBySp: Record<string, string>;
  onHoursChange: (sp: number, value: string) => void;
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
        Если ваша команда считает задачи в SP, активируйте переключатель. В появившейся форме укажите приблизительное значение SP в часах.
      </p>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          enabled
            ? "max-h-[600px] opacity-100"
            : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col gap-3">
          {DEFAULT_STORY_POINT_VALUES.map((sp) => (
            <div key={sp}>
              <label className="mb-1 block text-[13px] text-text">
                {sp} SP
              </label>
              <TextInput
                value={hoursBySp[String(sp)] ?? ''}
                onChange={(e) => onHoursChange(sp, e.target.value)}
                placeholder="Не задана"
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