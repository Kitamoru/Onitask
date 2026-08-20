'use client';

/**
 * ProgressSheet — промежуточный bottom sheet с индикацией прогресса создания задачи.
 *
 * Based on: onitask_ai_.md §3.1–§3.7, A-1 (Vercel Hot Path), A-6 (single model call)
 */

import { useEffect, useRef, useState } from 'react';

/** Стадии создания задачи — декоративная последовательность */
const STAGES = [
  'Распознаю данные…',
  'Собираю контекст…',
  'Создаю задачу…',
  'Почти готово…',
] as const;

/** Интервал смены стадий, ms */
const STAGE_INTERVAL_MS = 1600;

/**
 * CSS для анимации пульсирующей точки — инжектится один раз в <head>.
 */
const DOT_BREATHE_CSS = `
@keyframes dotBreathe {
  0%, 100% { transform: scale(0.85); opacity: 0.7; }
  50% { transform: scale(1.1); opacity: 1; }
}
`;

/**
 * ProgressContent — UI лоадера внутри BottomSheet.
 * Используется в TaskCreatorSheet при viewMode === 'loading'.
 */
export function ProgressContent() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy
      className="flex w-full items-center gap-3"
      style={{ minHeight: 56 }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: 'var(--color-accent-amber)',
          boxShadow:
            '0 0 6px rgba(245, 158, 11, 0.7), 0 0 16px rgba(245, 158, 11, 0.35)',
          animation: 'dotBreathe 1.4s ease-in-out infinite',
        }}
        aria-hidden="true"
      />
      <span
        className="text-sm tabular-nums"
        style={{
          color: 'var(--color-text-muted)',
          whiteSpace: 'nowrap',
          minWidth: 150,
        }}
      >
        <StageText />
      </span>
    </div>
  );
}

// ─── StageText — animated stage labels (fade transitions) ──────────────────

function StageText() {
  const [stageIndex, setStageIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inject @keyframes once
  useEffect(() => {
    const id = 'dot-breathe-style';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = DOT_BREATHE_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Start interval on mount
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setStageIndex((i) => (i + 1) % STAGES.length);
        setFading(false);
      }, 200);
    }, STAGE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return (
    <span
      style={{
        opacity: fading ? 0 : 1,
        transition: 'opacity 200ms ease',
      }}
    >
      {STAGES[stageIndex]}
    </span>
  );
}