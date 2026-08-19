/**
 * TaskCreatorSheet — F-04 task creation bottom sheet.
 *
 * Replaces the old AiInput overlay with a polished bottom sheet matching
 * the design prototype: dark theme, capture row (text input + mic + send),
 * waveform visualization during recording, CTA "Создать задачу", and
 * conditional CorrectionSheet for low-clarity tasks.
 *
 * Uses only existing design tokens from src/styles/tokens.css and globals.css.
 *
 * Based on: onitask_ai_.md §3.1–§3.7, TASKS.md Stage 5 F-04
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { CorrectionSheet } from './CorrectionSheet';
import type { ParseResponseV2, EnrichmentStrategy } from '@/lib/ai/types';

interface TaskCreatorSheetProps {
  initData: string;
  open: boolean;
  onClose: () => void;
  onTaskCreated: (taskId: string) => void;
}

interface CreateTaskResponse {
  task: { id: string };
  parse: ParseResponseV2;
  strategy: EnrichmentStrategy;
  showCorrectionSheet: boolean;
}

/** Number of bars in the waveform visualization */
const BAR_COUNT = 44;

export function TaskCreatorSheet({
  initData,
  open,
  onClose,
  onTaskCreated,
}: TaskCreatorSheetProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [parse, setParse] = useState<ParseResponseV2 | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Waveform state
  const [waveformBars, setWaveformBars] = useState<number[]>(() =>
    new Array(BAR_COUNT).fill(3)
  );
  const animFrameRef = useRef<number | null>(null);

  // Voice recorder
  const {
    state: recState,
    error: recError,
    start: startRec,
    stop: stopRec,
  } = useVoiceRecorder({
    initData,
    onTranscribed: (text) => setInput((prev) => (prev ? prev + ' ' : '') + text),
  });

  // Reset input when sheet closes
  useEffect(() => {
    if (!open) {
      setInput('');
      setError(null);
      setTaskId(null);
      setParse(null);
      setSheetOpen(false);
      setWaveformBars(new Array(BAR_COUNT).fill(3));
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }
  }, [open]);

  // Animate waveform bars during recording
  useEffect(() => {
    if (recState !== 'recording') {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const animate = () => {
      setWaveformBars((prev) =>
        prev.map(() => 3 + Math.random() * 25)
      );
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [recState === 'recording']);

  const handleClose = useCallback(() => {
    if (loading || recState === 'recording') return;
    onClose();
  }, [onClose, loading, recState]);

  const handleSubmit = async () => {
    if (!input.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData, input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка AI-создания задачи');

      const result = data as CreateTaskResponse;
      if (result.showCorrectionSheet) {
        setTaskId(result.task.id);
        setParse(result.parse);
        setSheetOpen(true);
      } else {
        setInput('');
        onTaskCreated(result.task.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка AI-создания задачи');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleConfirm = (edited: ParseResponseV2) => {
    setSheetOpen(false);
    setInput('');
    onTaskCreated(taskId ?? '');
  };

  const hasContent = input.trim().length > 0 || recState === 'idle';
  const isSendDisabled = loading || recState === 'recording' || !input.trim();

  // Mic icon SVG — changes based on recording state
  const micIcon = recState === 'recording' ? (
    // Stop icon
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  ) : (
    // Mic icon
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );

  // Send icon SVG
  const sendIcon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <path d="M3 11.5 20.5 3 15 20.5l-4-7-7-4Z" />
      <path d="M11 13.5 20.5 3" />
    </svg>
  );

  return (
    <>
      <BottomSheet open={open} onClose={handleClose}>
        {/* Sheet content */}
        <div className="px-4 pb-6 pt-2" style={{ paddingBottom: 'calc(var(--spacing-bottom-menu-padding) + env(safe-area-inset-bottom, 0px))' }}>
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="h-5 w-1 rounded"
                style={{ backgroundColor: 'var(--color-accent-amber)' }}
              />
              <h2
                className="m-0"
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-body-lg)',
                  fontWeight: 'var(--font-weight-medium)',
                  color: 'var(--color-text-primary)',
                }}
              >
                Новая задача
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading || recState === 'recording'}
              className="rounded-lg px-2 py-1 text-sm transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
              aria-label="Закрыть"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="w-5 h-5">
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          </div>

          {/* Capture row — text input + mic + send */}
          <div className="mb-4 flex items-center gap-2">
            {/* Input pill */}
            <div
              className="relative flex flex-1 items-center overflow-hidden rounded-2xl border transition-colors"
              style={{
                height: '56px',
                borderColor: recState === 'recording'
                  ? 'rgba(255, 153, 0, 0.35)'
                  : 'var(--color-line)',
                backgroundColor: 'var(--color-bg-surface)',
                boxShadow: recState === 'recording'
                  ? '0 0 0 0 rgba(255, 153, 0, 0.4)'
                  : 'none',
              }}
            >
              {recState === 'recording' ? (
                /* Recording state — waveform visualization */
                <div className="flex h-full w-full items-center px-4 gap-2.5">
                  {/* Red recording dot */}
                  <div
                    className="shrink-0 h-2 w-2 rounded-full animate-pulse"
                    style={{ backgroundColor: 'var(--color-error)' }}
                  />
                  {/* Timer placeholder — actual timer can be added later */}
                  <span
                    className="shrink-0 tabular-nums text-sm"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    0:00
                  </span>
                  {/* Waveform bars */}
                  <div className="flex flex-1 items-center gap-[3px] overflow-hidden">
                    {waveformBars.map((height, i) => (
                      <div
                        key={i}
                        className="w-[3px] rounded-sm transition-none"
                        style={{
                          height: `${height}px`,
                          backgroundColor: 'var(--color-accent-amber)',
                          opacity: height <= 3 ? 0.3 : 0.9,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                /* Idle state — text input */
                <input
                  className="flex-1 bg-transparent px-4 py-2 text-sm outline-none placeholder:text-[var(--color-text-muted)]"
                  style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-family-base)' }}
                  placeholder="Опишите задачу или запишите голосом…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  autoComplete="off"
                  aria-label="Ввод задачи"
                />
              )}
            </div>

            {/* Mic button */}
            <button
              type="button"
              onClick={recState === 'recording' ? stopRec : startRec}
              className="flex shrink-0 items-center justify-center rounded-2xl border p-[14px] transition-all active:scale-95"
              style={{
                width: '56px',
                height: '56px',
                borderColor: recState === 'recording'
                  ? 'var(--color-error)'
                  : 'var(--color-line-strong)',
                backgroundColor: recState === 'recording'
                  ? 'rgba(255, 59, 48, 0.1)'
                  : 'transparent',
                color: recState === 'recording'
                  ? 'var(--color-error)'
                  : 'var(--color-text-primary)',
              }}
              aria-label={recState === 'recording' ? 'Остановить запись' : 'Голосовой ввод'}
            >
              {micIcon}
            </button>

            {/* Send button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSendDisabled}
              className="flex shrink-0 items-center justify-center rounded-2xl border p-[14px] transition-all active:scale-95"
              style={{
                width: '56px',
                height: '56px',
                borderColor: isSendDisabled
                  ? 'var(--color-line)'
                  : 'var(--color-line-strong)',
                backgroundColor: 'transparent',
                color: isSendDisabled
                  ? 'var(--color-text-muted)'
                  : 'var(--color-text-primary)',
                opacity: isSendDisabled ? 0.32 : 1,
                cursor: isSendDisabled ? 'not-allowed' : 'pointer',
              }}
              aria-label="Отправить"
            >
              {sendIcon}
            </button>
          </div>

          {/* Description hint */}
          <p
            className="mb-6 text-sm leading-relaxed"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Текст или голос превратятся в задачу автоматически — заголовок, теги и срок будут распознаны из того, что вы скажете или напишете.
          </p>

          {/* Error message */}
          {recState === 'processing' && (
            <p className="mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Распознавание речи…
            </p>
          )}
          {(recState === 'error' && recError) && (
            <p className="mb-2 text-xs" style={{ color: 'var(--color-error)' }}>
              Ошибка распознавания: {recError}
            </p>
          )}
          {error && (
            <p className="mb-2 text-xs" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          )}

          {/* CTA — Создать задачу */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasContent || loading || recState === 'recording'}
            className="w-full flex h-[54px] items-center justify-center rounded-2xl text-base font-bold transition-all active:scale-[0.98]"
            style={{
              backgroundColor: hasContent && !loading && recState !== 'recording'
                ? 'var(--color-accent-amber)'
                : 'var(--color-line)',
              color: hasContent && !loading && recState !== 'recording'
                ? 'var(--color-accent-ink)'
                : 'var(--color-text-muted)',
              cursor: hasContent && !loading && recState !== 'recording'
                ? 'pointer'
                : 'not-allowed',
            }}
            aria-label="Создать задачу"
          >
            {loading ? (
              <div
                className="inline-block h-4 w-4 rounded-full border-2"
                style={{
                  borderColor: 'rgba(26, 18, 0, 0.25)',
                  borderTopColor: '#141008',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            ) : (
              <span>Создать задачу</span>
            )}
          </button>
        </div>
      </BottomSheet>

      {/* Correction Sheet — shown conditionally for low-clarity tasks */}
      <CorrectionSheet
        open={sheetOpen}
        taskId={taskId}
        parse={parse}
        initData={initData}
        onConfirm={handleConfirm}
        onCancel={() => setSheetOpen(false)}
      />
    </>
  );
}

// Note: Recording timer placeholder — actual elapsed time tracking can be
// added to useVoiceRecorder later if needed.
