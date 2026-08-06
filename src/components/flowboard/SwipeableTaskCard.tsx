'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TaskCard } from '@/components/stream';
import type { TaskEntity } from '@/types/flowboard';

/**
 * SwipeableTaskCard — обёртка над TaskCard с поддержкой свайпов для перемещения между колонками.
 *
 * Оптимизации:
 * - will-change: transform для GPU-композиции (убирает "деревянность")
 * - WebkitTapHighlightColor: transparent для мобильных
 * - touchAction: pan-y для корректной обработки скролла
 *
 * Поведение:
 * - Свайп вправо → следующая колонка
 * - Свайп влево → предыдущая колонка
 * - Tap (без свайпа) → onTap
 * - При достижении порога (80px) — вибрация + мгновенное перемещение
 * - Если порог не достигнут — bounce-back анимация
 */

const SWIPE_THRESHOLD = 80; // px
const SWIPE_MAX_TIME = 500; // ms

export interface SwipeableTaskCardProps {
  task: TaskEntity;
  /** Порядок колонок: ['backlog','in_progress','review','done'] */
  columnOrder: string[];
  /** Колонка, в которой находится задача */
  currentColumn: string;
  /** Перемещение в следующую колонку */
  onMoveNext: (taskId: string) => void;
  /** Перемещение в предыдущую колонку */
  onMovePrev: (taskId: string) => void;
  /** Обычный тап по карточке */
  onTap: (taskId: string) => void;
}

export function SwipeableTaskCard({
  task,
  columnOrder,
  currentColumn,
  onMoveNext,
  onMovePrev,
  onTap,
}: SwipeableTaskCardProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const isSwipingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const currentIndex = columnOrder.indexOf(currentColumn);
  const canMoveNext = currentIndex >= 0 && currentIndex < columnOrder.length - 1;
  const canMovePrev = currentIndex > 0;

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      startTime.current = Date.now();
      isSwipingRef.current = false;
      setIsSwiping(false);
      setTranslateX(0);
    },
    [],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = Math.abs(touch.clientY - startY.current);

      // Если вертикальное движение больше горизонтального — не считаем свайпом
      if (!isSwipingRef.current && deltaY > Math.abs(deltaX) && Math.abs(deltaX) < 10) {
        return;
      }

      if (!isSwipingRef.current && Math.abs(deltaX) > 8) {
        isSwipingRef.current = true;
        setIsSwiping(true);
      }

      if (isSwipingRef.current) {
        // Ограничиваем движение, если свайп не в разрешённом направлении
        const direction = deltaX > 0 ? 'next' : 'prev';
        const allowed =
          (direction === 'next' && canMoveNext) || (direction === 'prev' && canMovePrev);

        if (!allowed) {
          setTranslateX(0);
          return;
        }

        // Лёгкое сопротивление у края
        const maxDrag = 120;
        const clampedDelta =
          Math.abs(deltaX) > maxDrag
            ? Math.sign(deltaX) * (maxDrag + (Math.abs(deltaX) - maxDrag) * 0.2)
            : deltaX;

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          setTranslateX(clampedDelta);
        });
      }
    },
    [canMoveNext, canMovePrev],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      cleanup();

      const deltaX = (e.changedTouches[0]?.clientX ?? startX.current) - startX.current;
      const elapsed = Date.now() - startTime.current;

      if (!isSwipingRef.current) {
        // Это был тап
        onTap(task.id);
        return;
      }

      const absDelta = Math.abs(deltaX);
      const fastSwipe = elapsed < SWIPE_MAX_TIME && absDelta > 60;

      if (absDelta >= SWIPE_THRESHOLD || fastSwipe) {
        // Достигли порога — перемещаем
        if (deltaX > 0 && canMoveNext) {
          try { navigator.vibrate?.(50); } catch { /* not supported */ }
          onMoveNext(task.id);
        } else if (deltaX < 0 && canMovePrev) {
          try { navigator.vibrate?.(50); } catch { /* not supported */ }
          onMovePrev(task.id);
        } else {
          // Нельзя двигать в этом направлении — откат
          setTranslateX(0);
        }
      } else {
        // Не дошли до порога — bounce-back
        setTranslateX(0);
      }

      setIsSwiping(false);
      isSwipingRef.current = false;
    },
    [task.id, canMoveNext, canMovePrev, onMoveNext, onMovePrev, onTap, cleanup],
  );

  // Обработка мыши для десктопной отладки
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startY.current = e.clientY;
      startTime.current = Date.now();
      isSwipingRef.current = false;
      setIsSwiping(false);
      setTranslateX(0);

      const handleMouseMove = (ev: MouseEvent) => {
        const deltaX = ev.clientX - startX.current;
        const deltaY = Math.abs(ev.clientY - startY.current);

        if (!isSwipingRef.current && deltaY > Math.abs(deltaX) && Math.abs(deltaX) < 10) {
          return;
        }

        if (!isSwipingRef.current && Math.abs(deltaX) > 8) {
          isSwipingRef.current = true;
          setIsSwiping(true);
        }

        if (isSwipingRef.current) {
          const direction = deltaX > 0 ? 'next' : 'prev';
          const allowed =
            (direction === 'next' && canMoveNext) || (direction === 'prev' && canMovePrev);

          if (!allowed) {
            setTranslateX(0);
            return;
          }

          const maxDrag = 120;
          const clampedDelta =
            Math.abs(deltaX) > maxDrag
              ? Math.sign(deltaX) * (maxDrag + (Math.abs(deltaX) - maxDrag) * 0.2)
              : deltaX;

          setTranslateX(clampedDelta);
        }
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        const deltaX = ev.clientX - startX.current;
        const elapsed = Date.now() - startTime.current;

        if (!isSwipingRef.current) {
          onTap(task.id);
          return;
        }

        const absDelta = Math.abs(deltaX);
        const fastSwipe = elapsed < SWIPE_MAX_TIME && absDelta > 60;

        if (absDelta >= SWIPE_THRESHOLD || fastSwipe) {
          if (deltaX > 0 && canMoveNext) {
            onMoveNext(task.id);
          } else if (deltaX < 0 && canMovePrev) {
            onMovePrev(task.id);
          } else {
            setTranslateX(0);
          }
        } else {
          setTranslateX(0);
        }

        setIsSwiping(false);
        isSwipingRef.current = false;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [task.id, canMoveNext, canMovePrev, onMoveNext, onMovePrev, onTap],
  );

  // Bounce-back transition + GPU hint for smoother animation
  const cardStyle: React.CSSProperties = {
    transform: `translateX(${translateX}px)`,
    transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
    touchAction: 'pan-y',
    cursor: 'pointer',
    willChange: 'transform',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Задача ${task.full_id}. Свайп вправо для перемещения в следующую колонку, влево — в предыдущую.`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      style={cardStyle}
    >
      <TaskCard task={task} />
    </div>
  );
}