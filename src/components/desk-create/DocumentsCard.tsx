"use client";

import { useRef, useState } from "react";
import { Upload, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/desk-ui/Card";
import { ToggleSwitch } from "@/components/ui/desk-ui/ToggleSwitch";
import { Button } from "@/components/ui/desk-ui/Button";
import { NotchedPanel } from "@/components/ui/desk-ui/NotchedPanel";
import { CountBadge } from "@/components/ui/desk-ui/CountBadge";
import { cn } from "@/lib/cn";

const MAX_DOCUMENTS = 10;

// Status type for server-stored documents
export type DocumentStatus = "processing" | "completed" | "failed";

export interface ServerDocument {
  id: string;
  filename: string;
  file_type: "markdown" | "text";
  size_bytes: number;
  status: DocumentStatus;
  chunk_count: number;
  created_at: string;
}

interface DocumentsCardProps {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  // Local files (for create flow)
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  // Server documents (for edit flow)
  serverDocuments?: ServerDocument[];
  onDeleteServerDocument?: (documentId: string) => Promise<void>;
  // Shared
  disabled?: boolean;
  readOnly?: boolean;
  // Upload progress (for create flow)
  uploading?: boolean;
  uploadProgress?: number;
  uploadTotal?: number;
}

export function DocumentsCard({
  enabled,
  onEnabledChange,
  files = [],
  onFilesChange,
  serverDocuments = [],
  onDeleteServerDocument,
  disabled = false,
  readOnly = false,
  uploading = false,
  uploadProgress,
  uploadTotal,
}: DocumentsCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = files.length >= MAX_DOCUMENTS;

  const handlePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onFilesChange) return;
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    const existingKeys = new Set(files.map((f) => `${f.name}:${f.size}`));
    const deduped = picked.filter(
      (f) => !existingKeys.has(`${f.name}:${f.size}`)
    );
    onFilesChange([...files, ...deduped].slice(0, MAX_DOCUMENTS));
    e.target.value = "";
  };

  const removeLocalFile = (index: number) => {
    if (!onFilesChange) return;
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const openPicker = () => {
    if (!enabled || atLimit || disabled) return;
    inputRef.current?.click();
  };

  // Render status icon for server documents
  const renderStatusIcon = (status: DocumentStatus) => {
    switch (status) {
      case "processing":
        return <Loader2 className="h-4 w-4 animate-spin text-accent-amber" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed":
        return <AlertCircle className="h-4 w-4 text-accent-red" />;
      default:
        return null;
    }
  };

  // Render status label for server documents
  const renderStatusLabel = (status: DocumentStatus) => {
    switch (status) {
      case "processing":
        return "Обработка...";
      case "completed":
        return "Готово";
      case "failed":
        return "Ошибка";
      default:
        return "";
    }
  };

  const totalDocs = files.length + serverDocuments.length;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[15px] font-medium text-text">Документы</span>
        <ToggleSwitch
          checked={enabled}
          onChange={onEnabledChange}
          label="Документы"
          disabled={disabled}
        />
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          enabled
            ? "max-h-[1200px] opacity-100"
            : "max-h-0 opacity-0"
        }`}
      >
        {/* Local files (create flow) */}
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
                  {!readOnly && !uploading && (
                    <button
                      type="button"
                      onClick={() => removeLocalFile(i)}
                      aria-label={`Удалить ${file.name}`}
                      className="ml-3 shrink-0 text-text-muted hover:text-text"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </NotchedPanel>
              </li>
            ))}
          </ul>
        )}

        {/* Server documents (edit flow) */}
        {serverDocuments.length > 0 && (
          <ul className="mb-3 flex flex-col gap-2">
            {serverDocuments.map((doc) => (
              <li key={doc.id}>
                <NotchedPanel
                  corner="field"
                  fill="var(--color-surface)"
                  contentClassName="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {renderStatusIcon(doc.status)}
                    <span className="truncate text-[14px] text-text">
                      {doc.filename}
                    </span>
                    <span className="shrink-0 text-[12px] text-text-faint">
                      ({Math.round(doc.size_bytes / 1024)} KB)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-text-muted">
                      {renderStatusLabel(doc.status)}
                    </span>
                    {!readOnly && onDeleteServerDocument && (
                      <button
                        type="button"
                        onClick={() => onDeleteServerDocument(doc.id)}
                        aria-label={`Удалить ${doc.filename}`}
                        className="ml-2 shrink-0 text-text-muted hover:text-text"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </NotchedPanel>
              </li>
            ))}
          </ul>
        )}

        {/* Upload progress */}
        {uploading && uploadProgress !== undefined && uploadTotal && (
          <div className="mb-3 rounded-lg bg-surface px-4 py-3">
            <div className="mb-1 flex items-center justify-between text-[13px]">
              <span className="text-text-muted">Загрузка...</span>
              <span className="text-text-faint">
                {uploadProgress}/{uploadTotal}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full rounded-full bg-accent-amber transition-all duration-300"
                style={{
                  width: `${Math.round((uploadProgress / uploadTotal) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Upload button (local files) */}
        {!readOnly && onFilesChange && (
          <>
            <button
              type="button"
              disabled={disabled || !enabled || atLimit || uploading}
              onClick={openPicker}
              className={cn(
                "block h-10 w-full appearance-none border-0 bg-transparent p-0 text-left",
                (disabled || !enabled || atLimit || uploading) && "opacity-40"
              )}
            >
              <NotchedPanel
                corner="field"
                fill="var(--color-surface)"
                className="h-full"
                contentClassName="flex h-full w-full items-center justify-between px-4"
              >
                <span className="truncate text-base text-text-faint">
                  {uploading
                    ? "Загрузка..."
                    : disabled
                    ? "Загрузка отключена"
                    : "Выберите файл"}
                </span>
                <Upload className="h-[18px] w-[18px] shrink-0 text-text-muted" />
              </NotchedPanel>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".md,.txt"
              multiple
              hidden
              onChange={handlePicked}
            />

            <div className="mb-4 mt-3 flex items-start justify-between gap-3">
              <p className="flex-1 text-[13px] leading-[1.4] text-text-muted">
                до {MAX_DOCUMENTS} файлов, до 512 КБ каждый, форматы .md / .txt
              </p>
              <CountBadge>{totalDocs}/{MAX_DOCUMENTS}</CountBadge>
            </div>

            <Button
              variant="outline"
              disabled={disabled || !enabled || atLimit || uploading}
              onClick={openPicker}
            >
              Добавить файл
            </Button>
          </>
        )}

        {/* Read-only mode message */}
        {readOnly && serverDocuments.length === 0 && files.length === 0 && (
          <p className="py-2 text-[13px] text-text-faint">
            Нет загруженных документов
          </p>
        )}
      </div>
    </Card>
  );
}
