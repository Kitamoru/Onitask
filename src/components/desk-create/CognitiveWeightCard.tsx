"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";

export function CognitiveWeightCard({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Когнитивный вес
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Когнитивный вес"
        />
      </div>
      <p className="text-[13px] leading-[1.45] text-text-muted">
        Текст описание функционала когнитивного веса задачи, который
        расписан в 2–3 строчки, чтобы пользователь понимал, что оно из
        себя представляет
      </p>
    </Card>
  );
}