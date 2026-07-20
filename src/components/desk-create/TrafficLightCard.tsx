"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import { Stepper } from "@/components/ui/desk-ui/Stepper";

function dayLabel(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
    return `${n} дня`;
  }
  return `${n} дней`;
}

export function TrafficLightCard({
  enabled,
  onEnabledChange,
  warningDays,
  onWarningDaysChange,
  urgentDays,
  onUrgentDaysChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  warningDays: number;
  onWarningDaysChange: (v: number) => void;
  urgentDays: number;
  onUrgentDaysChange: (v: number) => void;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Сигналы светофора
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Сигналы светофора"
        />
      </div>
      <p className="mb-4 text-[13px] leading-[1.45] text-text-muted">
        Обозначьте срок, при котором коллегам будет приходить дополнительное
        уведомление о скором дедлайне задачи
      </p>

      <div className="flex flex-col gap-3">
        <Stepper
          value={warningDays}
          unitLabel={dayLabel}
          min={1}
          max={urgentDays - 1}
          onChange={onWarningDaysChange}
          borderGradient={["var(--color-grad-warning-from)", "var(--color-grad-warning-to)"]}
        />
        <Stepper
          value={urgentDays}
          unitLabel={dayLabel}
          min={warningDays + 1}
          max={30}
          onChange={onUrgentDaysChange}
          borderGradient={["var(--color-grad-urgent-from)", "var(--color-grad-urgent-to)"]}
        />
      </div>
    </Card>
  );
}