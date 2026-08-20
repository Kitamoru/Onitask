'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { useAutosizeTextarea } from '@/hooks/useAutosizeTextarea';
import { SingleDateField } from '@/components/ui/SingleDateField';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import { ProgressContent } from '@/components/ai/ProgressSheet';
import type { ParseResponseV2 } from '@/lib/ai/types';

interface TaskCreatorSheetProps {
  initData: string;
  open: boolean;
  onClose: () => void;
  onTaskCreated: (taskId: string) => void;
  workspaceId?: string | null;
}

interface CreateTaskResponse {
  task: { id: string };
  parse: ParseResponseV2;
}

interface CreateTaskError {
  error: string;
}

const BAR_COUNT = 44;

function Bar({ height, opacity }: { height: number; opacity: number }) {
  return (
    <div
      className="shrink-0 rounded-sm"
      style={{
        width: '3px',
        height: `${height}px`,
        backgroundColor: 'var(--color-accent-amber)',
        opacity,
      }}
    />
  );
}

export function TaskCreatorSheet({
  initData,
  open,
  onClose,
  onTaskCreated,
  workspaceId,
}: TaskCreatorSheetProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const [previewParse, setPreviewParse] = useState<ParseResponseV2 | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [waveformBars, setWaveformBars] = useState<number[]>(() =>
    new Array(BAR_COUNT).fill(3)
  );
  const animFrameRef = useRef<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const textareaRef = useAutosizeTextarea(input);

  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  const {
    state: recState,
    error: recError,
    start: startRec,
    stop: stopRec,
  } = useVoiceRecorder({
    initData,
    onTranscribed: (text) => {
      setInput((prev) => (prev ? prev + ' ' : '') + text.trim());
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      setIsProcessingVoice(false);
    },
  });

  // Reset everything when sheet opens/closes
  useEffect(() => {
    if (!open) {
      setInput('');
      setError(null);
      setLoading(false);
      setPreviewTaskId(null);
      setPreviewParse(null);
      setPreviewOpen(false);
      setWaveformBars(new Array(BAR_COUNT).fill(3));
      setRecordingSeconds(0);
      setIsProcessingVoice(false);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current = null;
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      dataArrayRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (recState === 'idle' || recState === 'error') {
      setIsProcessingVoice(false);
    }
  }, [recState, recError]);

  // Audio analyser setup (unchanged)
  useEffect(() => {
    if (recState === 'recording') {
      setRecordingSeconds(0);
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);

      const setupAnalyser = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = audioContext;
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;
          const bufferLength = analyser.frequencyBinCount;
          dataArrayRef.current = new Uint8Array(bufferLength);

          const source = audioContext.createMediaStreamSource(stream);
          sourceRef.current = source;
          source.connect(analyser);
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }
        } catch (err) {
          console.error('Failed to setup audio analyser:', err);
        }
      };
      setupAnalyser();

      let frameId: number | null = null;
      let isCancelled = false;

      const updateWaveform = () => {
        if (isCancelled || recState !== 'recording') return;
        if (analyserRef.current && dataArrayRef.current) {
          analyserRef.current.getByteFrequencyData(dataArrayRef.current);
          const data = dataArrayRef.current;
          const step = Math.floor(data.length / BAR_COUNT);
          const bars = new Array(BAR_COUNT).fill(0).map((_, i) => {
            let sum = 0;
            for (let j = 0; j < step; j++) {
              const idx = i * step + j;
              if (idx < data.length) sum += data[idx];
            }
            const avg = sum / step;
            return Math.max(3, Math.min(28, (avg / 255) * 25 + 3));
          });
          setWaveformBars(bars);
        }
        frameId = requestAnimationFrame(updateWaveform);
      };

      frameId = requestAnimationFrame(updateWaveform);
      animFrameRef.current = frameId;

      return () => {
        isCancelled = true;
        if (frameId !== null) {
          cancelAnimationFrame(frameId);
          animFrameRef.current = null;
        }
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        if (sourceRef.current) {
          try { sourceRef.current.disconnect(); } catch {}
          sourceRef.current = null;
        }
        if (audioContextRef.current) {
          try { audioContextRef.current.close(); } catch {}
          audioContextRef.current = null;
        }
        analyserRef.current = null;
        dataArrayRef.current = null;
      };
    } else {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (recState === 'idle' || recState === 'error') {
        setWaveformBars(new Array(BAR_COUNT).fill(3));
      }
    }
  }, [recState]);

  const handleClose = useCallback(() => {
    if (loading || recState === 'recording') return;
    onClose();
  }, [onClose, loading, recState]);

  const handleSubmit = async (text: string) => {
    if (!text.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: initData,
          input: text.trim(),
          workspace_id: workspaceId,
          priority: 'medium',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as CreateTaskError).error || 'Ошибка AI-создания задачи');

      const result = json as CreateTaskResponse;
      await Promise.all([
        Promise.resolve(),
        new Promise((r) => setTimeout(r, 400)),
      ]);
      setPreviewTaskId(result.task.id);
      setPreviewParse(result.parse);
      setPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка AI-создания задачи');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSendClick = () => {
    handleSubmit(input);
  };

  const handlePreviewConfirm = () => {
    setPreviewOpen(false);
    setInput('');
    if (previewTaskId) onTaskCreated(previewTaskId);
  };

  const hasContent = input.trim().length > 0;
  const isSendDisabled = loading || recState === 'recording' || !hasContent;

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Icons
  const micIcon = recState === 'recording' ? (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  ) : (
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

  // ─── CSS для SVG-анимации (длина пути 200px) ──────────────────────────
  const svgAnimationStyles = `
    .border-chase-svg {
      position: absolute;
      inset: -1px;
      width: calc(100% + 2px);
      height: calc(100% + 2px);
      pointer-events: none;
      z-index: 2;
      border-radius: 8px;
      overflow: visible;
    }
    .border-chase-path {
      fill: none;
      stroke: #f59e0b;
      stroke-width: 1;
      stroke-linecap: round;
      stroke-dasharray: 200; /* ← длина пути 200px */
      stroke-dashoffset: 0;
      animation: borderChase 2.4s linear infinite;
      filter:
        drop-shadow(0 0 2px rgba(245, 158, 11, 0.95))
        drop-shadow(0 0 8px rgba(245, 158, 11, 0.6))
        drop-shadow(0 0 16px rgba(245, 158, 11, 0.35));
    }
    @keyframes borderChase {
      to {
        stroke-dashoffset: -200; /* смещение равно длине пути */
      }
    }
  `;

  return (
    <>
      <style>{svgAnimationStyles}</style>

      <BottomSheet open={open} onClose={handleClose} preventSwipe={loading}>
        <div
          className="px-4 pb-6 pt-2"
          style={{
            paddingBottom: 'calc(var(--spacing-bottom-menu-padding) + env(safe-area-inset-bottom, 0px) + 16px)',
          }}
        >
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

          {/* Основной контейнер — форма или лоадер */}
          <div className="relative min-h-[180px]">
            {loading ? (
              // Лоадер создания задачи — поднят на 40px вверх
              <div
                className="flex items-center justify-center rounded-2xl bg-[var(--color-bg-surface)]/40 backdrop-blur-sm h-full min-h-[180px]"
                style={{ marginTop: '-40px' }}
              >
                <ProgressContent />
              </div>
            ) : (
              // Форма
              <div>
                {/* Capture row — текстовое поле + кнопки */}
                <div className="mb-4 flex items-end gap-2">
                  {/* Input container с SVG-анимацией */}
                  <div
                    className="relative flex flex-1 items-center rounded"
                    style={{
                      minHeight: '56px',
                      border: recState === 'recording'
                        ? '1px solid rgba(255, 153, 0, 0.35)'
                        : '1px solid var(--color-line)',
                      backgroundColor: '#101010',
                      borderRadius: '8px',
                      boxShadow: recState === 'recording'
                        ? '0 0 0 0 rgba(255, 153, 0, 0.4)'
                        : 'none',
                    }}
                  >
                    {/* SVG-анимация поверх инпута */}
                    {isProcessingVoice && (
                      <svg
                        className="border-chase-svg"
                        viewBox="0 0 100 56"
                        preserveAspectRatio="none"
                      >
                        <rect
                          x="1"
                          y="1"
                          width="98"
                          height="54"
                          rx="7"
                          className="border-chase-path"
                        />
                      </svg>
                    )}

                    <textarea
                      ref={textareaRef}
                      className="flex-1 resize-none bg-transparent px-4 text-sm outline-none placeholder:text-[var(--color-text-muted)]"
                      style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-family-base)',
                        minHeight: '56px',
                        maxHeight: '240px',
                        overflowY: 'auto',
                        paddingTop: '8px',
                        paddingBottom: '8px',
                        boxSizing: 'border-box',
                        opacity: recState === 'recording' ? 0 : 1,
                        transition: 'opacity 0.15s ease',
                        pointerEvents: recState === 'recording' ? 'none' : 'auto',
                      }}
                      placeholder="Опишите задачу или запишите голосом…"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendClick();
                        }
                      }}
                      autoComplete="off"
                      aria-label="Ввод задачи"
                    />

                    {/* Waveform overlay */}
                    {recState === 'recording' && (
                      <div className="pointer-events-none absolute inset-0 flex h-full w-full items-center px-4 gap-2.5">
                        <div
                          className="shrink-0 h-2 w-2 rounded-full"
                          style={{
                            backgroundColor: 'var(--color-error)',
                            animation: 'pulse 1s step-start infinite',
                          }}
                        />
                        <span
                          className="shrink-0 tabular-nums text-sm"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {formatTime(recordingSeconds)}
                        </span>
                        <div className="flex flex-1 items-center gap-[3px] overflow-hidden">
                          {waveformBars.map((height, i) => (
                            <Bar
                              key={i}
                              height={height}
                              opacity={height <= 3 ? 0.3 : 0.9}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mic button */}
                  <NotchedPanel
                    corner="action"
                    radius={4}
                    notch={8}
                    borderWidth={1}
                    border={recState === 'recording' ? 'var(--color-error)' : 'var(--color-line-strong)'}
                    fill="#101010"
                    className="shrink-0 self-end"
                  >
                    <button
                      type="button"
                      onClick={recState === 'recording' ? () => {
                        stopRec();
                        setIsProcessingVoice(true);
                      } : startRec}
                      className="flex h-full w-full items-center justify-center p-[14px] transition-all active:scale-95"
                      style={{
                        width: '56px',
                        height: '56px',
                        opacity: isProcessingVoice ? 0.32 : 1,
                        cursor: isProcessingVoice ? 'not-allowed' : 'pointer',
                        color: isProcessingVoice ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                      }}
                      disabled={isProcessingVoice}
                      aria-label={recState === 'recording' ? 'Остановить запись' : 'Голосовой ввод'}
                    >
                      {micIcon}
                    </button>
                  </NotchedPanel>

                  {/* Send button */}
                  <NotchedPanel
                    corner="action"
                    radius={4}
                    notch={8}
                    borderWidth={1}
                    border={isSendDisabled ? 'var(--color-line)' : 'var(--color-line-strong)'}
                    fill="#101010"
                    className="shrink-0 self-end"
                  >
                    <button
                      type="button"
                      onClick={handleSendClick}
                      disabled={isSendDisabled}
                      className="flex h-full w-full items-center justify-center p-[14px] transition-all active:scale-95"
                      style={{
                        width: '56px',
                        height: '56px',
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
                  </NotchedPanel>
                </div>

                {/* Description hint */}
                <p
                  className="mb-6 text-sm leading-relaxed"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Текст или голос превратятся в задачу — заголовок, теги и срок будут распознаны автоматически.
                </p>

                {/* Status messages */}
                {recState === 'error' && recError && (
                  <p className="mb-2 text-xs" style={{ color: 'var(--color-error)' }}>
                    Ошибка распознавания: {recError}
                  </p>
                )}
                {error && (
                  <p className="mb-2 text-xs" style={{ color: 'var(--color-error)' }}>
                    {error}
                  </p>
                )}

                {/* CTA */}
                <button
                  type="button"
                  onClick={handleSendClick}
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
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Task Preview Sheet */}
      <TaskPreviewSheet
        open={previewOpen}
        taskId={previewTaskId ?? ''}
        parse={previewParse}
        initData={initData}
        onConfirm={handlePreviewConfirm}
        onClose={handleClose}
        onCancel={() => {
          setPreviewOpen(false);
          setPreviewTaskId(null);
          setPreviewParse(null);
        }}
      />
    </>
  );
}

// ─── TaskPreviewSheet (без изменений) ──────────────────────────────────────

interface TaskPreviewSheetProps {
  open: boolean;
  taskId: string;
  parse: ParseResponseV2 | null;
  initData: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose?: () => void;
}

function TaskPreviewSheet({ open, taskId, parse, initData, onConfirm, onCancel, onClose }: TaskPreviewSheetProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ParseResponseV2 | null>(parse);

  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState<Date | null>(null);
  useEffect(() => {
    if (draft?.deadline) {
      setDeadlineDate(new Date(draft.deadline));
    } else {
      setDeadlineDate(null);
    }
  }, [draft?.deadline]);

  useEffect(() => {
    if (parse) setDraft(parse);
  }, [parse]);

  useEffect(() => {
    if (!open) setDraft(null);
  }, [open]);

  if (!open || !draft) return null;

  const setField = <K extends keyof ParseResponseV2>(key: K, value: ParseResponseV2[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!draft) return;
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      setError('Название задачи не может быть пустым');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const safePriority = draft.priority && draft.priority.trim() !== '' ? draft.priority : 'medium';
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: initData,
          title: trimmedTitle,
          description: draft.rewritten_description,
          priority: safePriority,
          deadline: draft.deadline,
          tags: draft.tags,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');
      onConfirm();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return 'Не указан';
    try {
      const date = new Date(d);
      return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  };

  const priorityLabel = (p: string | null) => {
    switch (p) {
      case 'high': return '🔴 Высокий';
      case 'low': return '🟢 Низкий';
      default: return '🟡 Средний';
    }
  };

  const isTitleEmpty = !draft.title.trim();
  const isSaveDisabled = saving || isTitleEmpty;

  return (
    <>
      <BottomSheet open={open} onClose={onCancel} preventSwipe>
        <div className="px-4 pb-6 pt-2">
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
                Задача создана
              </h2>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
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

          {/* Title */}
          <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Название
          </label>
          <input
            className="mb-4 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--color-accent-amber)]"
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderColor: 'var(--color-line)',
              color: 'var(--color-text-primary)',
            }}
            value={draft.title}
            onChange={(e) => setField('title', e.target.value)}
            aria-label="Название задачи"
          />

          {/* Description */}
          <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Описание
          </label>
          <AutoResizeTextarea
            className="mb-4 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--color-accent-amber)]"
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderColor: 'var(--color-line)',
              color: 'var(--color-text-primary)',
            }}
            value={draft.rewritten_description ?? ''}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setField('rewritten_description', e.target.value)}
            aria-label="Описание"
            placeholder="Описание"
          />

          {/* Priority + Deadline row */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Приоритет
              </label>
              <select
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--color-accent-amber)]"
                style={{
                  backgroundColor: 'var(--color-bg-surface)',
                  borderColor: 'var(--color-line)',
                  color: 'var(--color-text-primary)',
                }}
                value={draft.priority ?? ''}
                onChange={(e) => setField('priority', (e.target.value || null) as ParseResponseV2['priority'])}
                aria-label="Приоритет"
              >
                <option value="">Средний</option>
                <option value="high">Высокий</option>
                <option value="medium">Средний</option>
                <option value="low">Низкий</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Дедлайн
              </label>
              <SingleDateField
                date={deadlineDate}
                onOpen={() => setIsDateSheetOpen(true)}
                placeholder="Дедлайн"
              />
            </div>
          </div>

          {/* Tags */}
          {draft.tags.length > 0 && (
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Теги
              </label>
              <div className="flex flex-wrap gap-2">
                {draft.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: 'rgba(255, 159, 10, 0.15)',
                      color: 'var(--color-accent-amber)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="mb-6 flex items-center justify-between rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-surface)', borderColor: 'var(--color-line)' }}>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {priorityLabel(draft.priority)}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Дедлайн: {formatDate(draft.deadline)}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Ясность: {Math.round(draft.clarity_score * 100)}%
            </span>
          </div>

          {/* Error */}
          {error && (
            <p className="mb-3 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 rounded-xl py-3 text-sm font-medium transition-all active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--color-bg-surface)',
                color: 'var(--color-text-muted)',
                border: `1px solid var(--color-line)`,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.5 : 1,
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaveDisabled}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-white transition-all active:scale-[0.98]"
              style={{
                backgroundColor: isSaveDisabled ? 'rgba(255, 159, 10, 0.3)' : 'var(--color-accent-amber)',
                cursor: isSaveDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Сохранение…' : 'Готово'}
            </button>
          </div>
        </div>
      </BottomSheet>

      <SingleDateSheet
        open={isDateSheetOpen}
        onClose={() => setIsDateSheetOpen(false)}
        date={deadlineDate}
        onConfirm={(d: Date) => {
          setDeadlineDate(d);
          setField('deadline', d.toISOString());
        }}
      />
    </>
  );
}