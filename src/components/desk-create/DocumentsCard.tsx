"use client";

import { useRef } from "react";
import { Upload, X } from "lucide-react";
import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import { Button } from "@/components/ui/desk-ui/Button";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import { CountBadge } from "@/components/ui/desk-ui/CountBadge";
import { cn } from "@/lib/cn";

const MAX_DOCUMENTS = 10;

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
  const atLimit = files.length >= MAX_DOCUMENTS;

  const handlePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    // Dedup by name+size — re-opening the picker and re-selecting a file
    // already in the list (easy to do by accident) shouldn't double it.
    const existingKeys = new Set(files.map((f) => `${f.name}:${f.size}`));
    const deduped = picked.filter(
      (f) => !existingKeys.has(`${f.name}:${f.size}`)
    );
    onFilesChange([...files, ...deduped].slice(0, MAX_DOCUMENTS));
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const openPicker = () => {
    if (!enabled || atLimit) return;
    inputRef.current?.click();
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

      {files.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${file.size}-${i}`}>
              <NotchedPanel
                corner="field"
                fill="var(--color-surface)"
                contentClassName="flex items-center justify-between px-4 py-3"
              >
                <span className="truncate text-[14px] text-text">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Удалить ${file.name}`}
                  className="ml-3 shrink-0 text-text-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </NotchedPanel>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={!enabled || atLimit}
        onClick={openPicker}
        className={cn(
          "block h-10 w-full appearance-none border-0 bg-transparent p-0 text-left",
          (!enabled || atLimit) && "opacity-40"
        )}
      >
        <NotchedPanel
          corner="field"
          fill="var(--color-surface)"
          contentClassName="flex h-full w-full items-center justify-between px-4"
        >
          <span className="truncate text-base text-text-faint">
            Выберите файл
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

      <div className="mb-4 mt-3 flex items-start justify-between gap-3">
        <p className="flex-1 text-[13px] leading-[1.4] text-text-muted">
          до 10 документов, до 5 мегабайт в сумме, формат .md
        </p>
        <CountBadge>{files.length}/{MAX_DOCUMENTS}</CountBadge>
      </div>

      <Button
        variant="outline"
        disabled={!enabled || atLimit}
        onClick={openPicker}
      >
        Добавить .md файл
      </Button>
    </Card>
  );
}