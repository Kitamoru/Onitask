"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SprintCreateSheet } from "@/components/sprint/SprintCreateSheet";
import { SprintEditSheet } from "@/components/sprint/SprintEditSheet";
import { SprintViewSheet } from "@/components/sprint/SprintViewSheet";
import type { SprintFormValue, SprintStats } from "@/components/sprint/types";

type Sprint = Omit<SprintFormValue, "capacity"> & { capacity: string };

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

function computeDaysLeft(endDate: Date | null): number {
  if (!endDate) return 0;
  const now = new Date();
  const diff = Math.ceil((endDate.getTime() - now.getTime()) / ONE_DAY_MS);
  return Math.max(0, diff);
}

/**
 * Wires the three sheets into one flow: no sprint → Create → (submit) →
 * View → (edit icon) → Edit → (save) → back to View → (complete) → back
 * to no-sprint state, or (create new) → fresh Create.
 *
 * Real integration note: BottomSheet keeps its children mounted even
 * while closed (so the slide-down close animation has something to
 * animate) — that means SprintCreateSheet/SprintEditSheet's own
 * internal useState does NOT reset itself just because `open` went back
 * to false. Both are given a `key` here that changes only when we
 * actually want a clean form, forcing React to remount them at that
 * point. Drop the `key` if you convert either sheet to be fully
 * externally-controlled (value/onChange from this parent) instead of
 * self-contained — then you wouldn't need the remount trick at all.
 */
export function SprintFlowPage() {
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [stats, setStats] = useState<SprintStats>({
    completedTasks: 0,
    totalTasks: 0,
    daysLeft: 0,
  });

  const [activeSheet, setActiveSheet] = useState<
    "none" | "create" | "edit" | "view"
  >("none");
  const [createKey, setCreateKey] = useState(0);
  const [editKey, setEditKey] = useState(0);

  const openFreshCreate = () => {
    setCreateKey((k) => k + 1);
    setActiveSheet("create");
  };

  const handleCreateSubmit = (value: SprintFormValue) => {
    setSprint(value);
    // Demo-only mock stats for a brand-new sprint — wire to real task
    // counts once there's a backend behind this.
    setStats({
      completedTasks: 0,
      totalTasks: 0,
      daysLeft: computeDaysLeft(value.endDate),
    });
    setActiveSheet("view");
  };

  const handleEditSubmit = (value: Omit<SprintFormValue, "capacity">) => {
    setSprint((prev) => (prev ? { ...prev, ...value } : null));
    setStats((prev) => ({ ...prev, daysLeft: computeDaysLeft(value.endDate) }));
    setActiveSheet("view");
  };

  return (
    <main className="min-h-screen bg-bg p-4">
      {!sprint && (
        <Button variant="solid" onClick={openFreshCreate}>
          Создать спринт
        </Button>
      )}
      {sprint && (
        <Button variant="outline" onClick={() => setActiveSheet("view")}>
          Открыть текущий спринт
        </Button>
      )}

      <SprintCreateSheet
        key={createKey}
        open={activeSheet === "create"}
        onClose={() => setActiveSheet(sprint ? "view" : "none")}
        onSubmit={handleCreateSubmit}
      />

      {sprint && (
        <>
          <SprintEditSheet
            key={editKey}
            open={activeSheet === "edit"}
            onClose={() => setActiveSheet("view")}
            initialValue={sprint}
            stats={stats}
            onSubmit={handleEditSubmit}
          />

          <SprintViewSheet
            open={activeSheet === "view"}
            onClose={() => setActiveSheet("none")}
            sprint={sprint}
            stats={stats}
            isActive
            onEdit={() => {
              setEditKey((k) => k + 1);
              setActiveSheet("edit");
            }}
            onComplete={() => {
              // wire to a real "archive sprint" mutation here
              setSprint(null);
              setActiveSheet("none");
            }}
            onCreateNew={openFreshCreate}
          />
        </>
      )}
    </main>
  );
}
