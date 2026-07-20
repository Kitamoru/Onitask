"use client";

import { Card } from "@/components/ui/desk-ui/Card";
import { CountBadge } from "@/components/ui/desk-ui/CountBadge";
import { Button } from "@/components/ui/desk-ui/Button";
import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";

export function CoworkingSection({
  colleagueCount,
  onAddColleague,
}: {
  colleagueCount: number;
  onAddColleague: () => void;
}) {
  return (
    <section>
      <SectionHeader title="Коворкинг" />
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[15px] font-medium text-text">
            Список коллег
          </span>
          <CountBadge>{colleagueCount} коллег</CountBadge>
        </div>
        <Button variant="outline" onClick={onAddColleague}>
          Добавить коллегу
        </Button>
      </Card>
    </section>
  );
}