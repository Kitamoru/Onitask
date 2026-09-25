"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";

export function CognitiveWeightCard({
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
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">
          Когнитивный вес
        </span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Когнитивный вес"
          disabled={disabled}
        />
      </div>
      <p className="text-[13px] leading-[1.45] text-text-muted">
        Когнитивный вес оценивает, насколько задача требует внимания и умственных усилий. Значение задаётся от 0 до 3: от простой рутины до сложной задачи. FlowBoard учитывает суммарный вес задач участника, чтобы показывать его текущую нагрузку и перегруженность.
      </p>
    </Card>
  );
}