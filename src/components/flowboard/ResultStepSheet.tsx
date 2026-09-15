'use client';

/**
 * ResultStepSheet — SUBMIT-01: шаг «Результат» при сдаче задачи.
 *
 * Открывается при forward-переходе задачи в review/done (перехват в
 * flowboard/page.tsx handleMoveTask). Один экран:
 *   - «Что сделано» — TextArea (обязательный шаг, но текст опционален:
 *     можно сдать без заполнения);
 *   - Файлы (до 5, File objects в памяти, грузятся только при submit);
 *   - Ссылки [{label, url}] (ExternalLinksCard-совместимый формат);
 *   - [Назад] / [На проверку | Сделано] — колонка подтверждается в конце.
 *
 * Prefill (review→done): текст/ссылки последней сдачи исполнителя
 * подставляются в форму ревьюера; без правки — approve последней сдачи
 * (RPC submit_task p_edited=false, без дубля в истории).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Paperclip, Link2, X, Loader2, Upload } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { TextInput } from '@/components/ui/desk-ui/TextInput';
import { TextArea } from '@/components/ui/desk-ui/TextArea';
import { CountBadge } from '@/components/ui/desk-ui/CountBadge';
import { getLatestTaskSubmission } from '@/lib/api/flow';
import type { TaskEntity, TaskSubmissionLink } from '@/types/flowboard';

const MAX_SUBMISSION_FILES = 5;

export interface ResultStepSheetProps {
  open: boolean;
  task: TaskEntity | null;
  targetColumn: 'review' | 'done' | null;
  submitting: boolean;
  uploadCount: number;
  uploadTotal: number;
  error: string | null;
  onSubmit: (payload: {
    bodyText: string;
    files: File[];
    links: TaskSubmissionLink[];
    edited: boolean;
  }) => void;
  onClose: () => void;
}

function successHaptic() {
  void (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success') as void;
}

export function ResultStepSheet({
  open,
  task,
  targetColumn,
  submitting,
  uploadCount,
  uploadTotal,
  error,
  onSubmit,
  onClose,
}: ResultStepSheetProps) {
  const [bodyText, setBodyText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<TaskSubmissionLink[]>([]);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const appliedPrefillRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fromColumn = task?.column ?? null;
  // Prefill-режим: review→done — подтягиваем последнюю сдачу исполнителя
  const prefillEnabled = !!(open && task && targetColumn === 'done' && fromColumn === 'review');
  const { data: prefillData, isLoading: prefillLoading } = useQuery({
    queryKey: ['task-submissions-latest', task?.id],
    queryFn: () => getLatestTaskSubmission(task!.id),
    enabled: prefillEnabled && !!task?.id,
  });
  const prefill = prefillData?.submission ?? null;

  // Сброс локального стейта при каждом открытии
  useEffect(() => {
    if (!open) {
      setBodyText('');
      setFiles([]);
      setLinks([]);
      setLinkTitle('');
      setLinkUrl('');
      appliedPrefillRef.current = null;
    }
  }, [open]);

  // Prefill: текст/ссылки исполнителя → в форму ревьюера (один раз на сдачу)
  useEffect(() => {
    if (!prefillEnabled || !prefill) return;
    if (appliedPrefillRef.current === prefill.id) return;
    appliedPrefillRef.current = prefill.id;
    setBodyText(prefill.body_text ?? '');
    setLinks(Array.isArray(prefill.links) ? prefill.links : []);
  }, [prefillEnabled, prefill]);

  // edited: текст/ссылки не менялись с последней сдачи → approve без дубля
  const edited = useMemo(() => {
    if (!prefill) return true;
    const prefillLinks = Array.isArray(prefill.links) ? prefill.links : [];
    const linksSame = JSON.stringify(links) === JSON.stringify(prefillLinks);
    return !(bodyText === (prefill.body_text ?? '') && linksSame);
  }, [prefill, bodyText, links]);

  const atFileLimit = files.length >= MAX_SUBMISSION_FILES;

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    const existingKeys = new Set(files.map((f) => `${f.name}:${f.size}`));
    const deduped = picked.filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
    setFiles((prev) => [...prev, ...deduped].slice(0, MAX_SUBMISSION_FILES));
    e.target.value = '';
  };

  const canAddLink = linkTitle.trim() && linkUrl.trim();
  const addLink = () => {
    if (!canAddLink) return;
    setLinks((prev) => [...prev, { label: linkTitle.trim(), url: linkUrl.trim() }]);
    setLinkTitle('');
    setLinkUrl('');
  };

  // Пока префилл не загружен — не даём сдать (иначе мимо approve-ветки)
  const submitDisabled =
    submitting || (prefillEnabled && (prefillLoading || !prefillData));

  const primaryLabel = targetColumn === 'done' ? 'Сделано' : 'На проверку';
  const primaryFill =
    targetColumn === 'done'
      ? 'var(--color-signal-green)'
      : 'var(--color-signal-cyan)';

  const handleSubmit = () => {
    if (submitDisabled || !task || !targetColumn) return;
    successHaptic();
    onSubmit({
      bodyText: bodyText.trim(),
      files,
      links: links.filter((l) => l.url.length > 0),
      edited,
    });
  };

  return (
    <BottomSheet open={open} onClose={onClose} stacked>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* Header — полный id задачи + title */}
        <div className="flex flex-col gap-1">
          <h3 className="text-[17px] font-semibold text-text">
            {`Результат · ${task?.full_id ?? ''}`}
          </h3>
          <p className="truncate text-sm font-medium leading-snug text-text">
            {task?.title ?? ''}
          </p>
        </div>

        {/* Что сделано — TextArea (компонент сам делает autosize) */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-medium text-text">Что сделано</span>
          <TextArea
            value={bodyText}
            onChange={setBodyText}
            placeholder="Что сделано? Как проверить?"
            disabled={submitting}
            className="min-h-[88px]"
          />
          {prefillEnabled && prefill && (
            <p className="text-[13px] text-text-muted">
              Результат исполнителя подставлен — исправьте или подтвердите как есть.
              {prefill.files_count > 0 && ` 📎 ${prefill.files_count} файл(ов) уже приложено к сдаче.`}
            </p>
          )}
        </div>

        {/* Файлы (File objects в памяти — грузятся только при submit) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-text">📎 Файлы</span>
            <CountBadge>
              {files.length}/{MAX_SUBMISSION_FILES}
            </CountBadge>
          </div>
          {files.map((file, i) => (
            <NotchedPanel
              key={`${file.name}-${i}`}
              corner="field"
              fill="var(--color-surface)"
              contentClassName="flex items-center justify-between gap-2 px-4 py-2.5"
            >
              <span className="truncate text-[14px] text-text">{file.name}</span>
              {!submitting && (
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Удалить файл"
                  className="shrink-0 text-text-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </NotchedPanel>
          ))}
          {submitting && uploadTotal > 0 && (
            <p className="text-[13px] text-text-muted">
              {`Загрузка файлов ${uploadCount}/${uploadTotal}…`}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
            className="hidden"
            onChange={handleFilesPicked}
          />
          {/* Поле-пикер в стиле TaskViewEdit: NotchedPanel + иконка Upload */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting || atFileLimit}
            className="block h-10 w-full appearance-none border-0 bg-transparent p-0 text-left disabled:opacity-40"
          >
            <NotchedPanel
              corner="field"
              fill="var(--color-surface)"
              className="h-full"
              contentClassName="flex h-full w-full items-center justify-between px-4"
            >
              <span className="truncate text-base text-text-faint">
                {atFileLimit
                  ? `Лимит — ${MAX_SUBMISSION_FILES} файлов`
                  : files.length > 0
                    ? 'Добавить файлы'
                    : 'Выберите файл'}
              </span>
              <Upload className="h-[18px] w-[18px] shrink-0 text-text-muted" />
            </NotchedPanel>
          </button>
        </div>

        {/* Ссылки [{label, url}] — формат ExternalLinksCard */}
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-medium text-text">🔗 Ссылки</span>
          {links.map((link, i) => (
            <NotchedPanel
              key={`${link.url}-${i}`}
              corner="field"
              fill="var(--color-surface)"
              contentClassName="flex items-center justify-between gap-2 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-text">{link.label}</p>
                <p className="truncate text-[12px] text-text-muted">{link.url}</p>
              </div>
              {!submitting && (
                <button
                  type="button"
                  onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Удалить ссылку"
                  className="shrink-0 text-text-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </NotchedPanel>
          ))}
          <div className="flex flex-col gap-3">
            <TextInput
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              placeholder="Название ресурса"
              disabled={submitting}
            />
            <TextInput
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Ссылка"
              disabled={submitting}
            />
            <Button
              variant="outline"
              onClick={addLink}
              disabled={submitting || !canAddLink}
            >
              Добавить ссылку
            </Button>
          </div>
        </div>

        {/* Ошибка сдачи (версионный конфликт и др.) */}
        {error && (
          <p className="text-[13px]" style={{ color: 'var(--color-accent-red)' }}>
            {error}
          </p>
        )}

        {/* [Назад] | [На проверку / Сделано] — колонка подтверждается в конце */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1">
            Назад
          </Button>
          <Button
            variant="solid"
            fill={primaryFill}
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="flex-1"
          >
            {submitting ? 'Сдаём…' : primaryLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
