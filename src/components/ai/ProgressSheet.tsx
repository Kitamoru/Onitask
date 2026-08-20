'use client';

/**
 * ProgressSheet — промежуточный bottom sheet с индикацией прогресса создания задачи.
 *
 * Показывается сразу после нажатия «Создать задачу» и закрывается, когда
 * /api/ai/create-task завершил работу. Стадии идут по таймеру (декоративные,
 * не привязаны к реальному прогрессу бэкенда) — синхронизировать нельзя, т.к.
 * основной шаг (вызов NDH/Groq) неделим и занимает бóльшую часть времени.
 *
 * - preventSwipe: нельзя закрыть свайпом/бэкдропом во время загрузки
 * - Пульсирующая amber-точка (dotBreathe), как в макете
 * - Смена стадий с fade-переходом (каждые 1600ms)
 * - aria-live="polite" для доступности
 *
 * Based on: onitask_ai_.md §3.1–§3.7, A-1 (Vercel Hot Path), A-6 (single model call)
 */

import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';

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
 * (Аналогично ROTATION_CSS в BottomMenu.tsx.)
 */
const DOT_BREATHE_CSS = `
@keyframes dotBreathe {
  0%, 100% { transform: scale(0.85); opacity: 0.7; }
  50% { transform: scale(1.1); opacity: 1; }
}
`;

export function ProgressSheet({ open }: { open: boolean }) {
  // Индекс текущей стадии (0..STAGES.length-1)
  const [stageIndex, setStageIndex] = useState(0);
  // Флаг перехода (fade) — для плавной смены текста
  const [fading, setFading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Инжектим @keyframes dotBreathe в <head> один раз
  useEffect(() => {
    const id = 'dot-breathe-style';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = DOT_BREATHE_CSS;
      document.head.appendChild(style);
    }
  }, []);

  // Сброс при открытии/закрытии
  useEffect(() => {
    if (!open) {
      setStageIndex(0);
      setFading(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Таймер смены стадий: сначала fade-out, затем смена текста + fade-in
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
  }, [open]);

  return (
    <BottomSheet open={open} onClose={() => {}} preventSwipe>
      <div
        className="px-4 pb-6 pt-2"
        style={{
          paddingBottom:
            'calc(var(--spacing-bottom-menu-padding) + env(safe-area-inset-bottom, 0px) + 16px)',
        }}
      >
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
              Создание задачи
            </h2>
          </div>
        </div>

        {/* Стадии с пульсирующей точкой */}
        <div
          role="status"
          aria-live="polite"
          aria-busy={open}
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
              opacity: fading ? 0 : 1,
              transition: 'opacity 200ms ease',
            }}
          >
            {STAGES[stageIndex]}
          </span>
        </div>
      </div>
    </BottomSheet>
  );
}