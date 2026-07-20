"use client";

import { useRef } from "react";
import { Upload } from "lucide-react";
import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import { Button } from "@/components/ui/desk-ui/Button";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import { cn } from "@/lib/cn";

export function DocumentsCard({
  enabled,
  onEnabledChange,
  files,
  onFilesChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latestFileName = files[files.length - 1]?.name;

  const handlePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    onFilesChange([...files, ...picked].slice(0, 10));
    e.target.value = "";
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">Документы</span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Документы"
        />
      </div>

      <button
        type="button"
        disabled={!enabled}
        onClick={() => inputRef.current?.click()}
        className={cn("block h-[52px] w-full appearance-none border-0 bg-transparent p-0 text-left", !enabled && "opacity-40")}
      >
        <NotchedPanel
          corner="field"
          fill="var(--color-surface)"
          contentClassName="flex h-full w-full items-center justify-between px-4"
        >
          <span
            className={cn(
              "truncate text-base",
              latestFileName ? "text-text" : "text-text-faint"
            )}
          >
            {latestFileName ?? "Выберите файл"}
          </span>
          <Upload className="h-[18px] w-[18px] shrink-0 text-text-muted" />
        </NotchedPanel>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md"
        multiple
        hidden
        onChange={handlePicked}
      />

      <p className="mb-4 mt-3 text-[13px] leading-[1.4] text-text-muted">
        до 10 документов, до 5 мегабайт в сумме, формат .md
      </p>

      <Button
        variant="outline"
        disabled={!enabled}
        onClick={() => inputRef.current?.click()}
      >
        Добавить .md файл
      </Button>
    </Card>
  );
}