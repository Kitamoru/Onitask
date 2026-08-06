'use client';

import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import { TaskCard } from '@/components/stream';
import type { TaskEntity } from '@/types/flowboard';

/**
 * SwipeableTaskCard — обёртка над TaskCard с оптимизированным свайпом.
 *
 * Оптимизации:
 * - Transform применяется напрямую через DOM ref (без React re-render во время драга)
 * - will-change: transform для GPU-композиции
 * - Passive touch listeners где возможно
 * - CSS transition для bounce-back
 * - React.memo для предотвращения лишних ререндеров
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
const MAX_DRAG = 120; // px
const CLAMP_FACTOR = 0.2; // сопротивление за пределами MAX_DRAG

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

function SwipeableTaskCardInner({
  task,
  columnOrder,
  currentColumn,
  onMoveNext,
  onMovePrev,
  onTap,
}: SwipeableTaskCardProps) {
  // Ref-driven transform — avoids React re-renders during drag
  const cardRef = useRef<HTMLDivElement>(null);
  const translateXRef = useRef(0);
  const isSwipingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const hasCommittedRef = useRef(false); // tracks if we already fired move callback this gesture

  const currentIndex = columnOrder.indexOf(currentColumn);
  const canMoveNext = currentIndex >= 0 && currentIndex < columnOrder.length - 1;
  const canMovePrev = currentIndex > 0;

  // Apply transform directly to DOM node — no setState
  const applyTransform = useCallback((value: number) => {
    const el = cardRef.current;
    if (el) {
      el.style.transform = `translateX(${value}px)`;
    }
    translateXRef.current = value;
  }, []);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Start a new gesture
  const beginGesture = useCallback((clientX: number, clientY: number) => {
    startXRef.current = clientX;
    startYRef.current = clientY;
    startTimeRef.current = Date.now();
    isSwipingRef.current = false;
    hasCommittedRef.current = false;
    applyTransform(0);
  }, [applyTransform]);

  // Determine if horizontal movement exceeds threshold to start swiping
  const shouldStartSwiping = useCallback((deltaX: number, deltaY: number): boolean => {
    return Math.abs(deltaX) > 8 && Math.abs(deltaX) >= Math.abs(deltaY);
  }, []);

  // Clamp drag with resistance at edges
  const clampDrag = useCallback((deltaX: number): number => {
    const absDelta = Math.abs(deltaX);
    if (absDelta > MAX_DRAG) {
      return Math.sign(deltaX) * (MAX_DRAG + (absDelta - MAX_DRAG) * CLAMP_FACTOR);
    }
    return deltaX;
  }, []);

  // Handle pointer move (touch or mouse)
  const handlePointerMove = useCallback(
    (clientX: number, clientY: number, isMouse: boolean) => {
      const deltaX = clientX - startXRef.current;
      const deltaY = Math.abs(clientY - startYRef.current);

      // Not yet started swiping? Check if we should
      if (!isSwipingRef.current) {
        if (shouldStartSwiping(deltaX, deltaY)) {
          isSwipingRef.current = true;
          // Disable transition once swiping starts for instant response
          const el = cardRef.current;
          if (el) {
            el.style.transition = 'none';
          }
        } else {
          return;
        }
      }

      if (!isSwipingRef.current) return;

      // Check direction constraints
      const direction = deltaX > 0 ? 'next' : 'prev';
      const allowed =
        (direction === 'next' && canMoveNext) || (direction === 'prev' && canMovePrev);

      if (!allowed) {
        applyTransform(0);
        return;
      }

      // Schedule transform update on next frame (throttled to display refresh)
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      animFrameRef.current = requestAnimationFrame(() => {
        applyTransform(clampDrag(deltaX));
      });
    },
    [canMoveNext, canMovePrev, shouldStartSwiping, clampDrag, applyTransform]
  );

  // End gesture and decide: commit move or bounce back
  const endGesture = useCallback(
    (finalClientX: number, finalClientY: number, isMouse: boolean) => {
      const deltaX = finalClientX - startXRef.current;
      const deltaY = Math.abs(finalClientY - startYRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      const absDelta = Math.abs(deltaX);

      // If we never entered swipe mode, it was a tap
      if (!isSwipingRef.current) {
        onTap(task.id);
        return;
      }

      // Restore transition for smooth bounce-back
      const el = cardRef.current;
      if (el) {
        el.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
      }

      // Check threshold: static drag or fast flick
      const fastSwipe = elapsed < SWIPE_MAX_TIME && absDelta > 60;
      const thresholdMet = absDelta >= SWIPE_THRESHOLD || fastSwipe;

      if (thresholdMet) {
        if (deltaX > 0 && canMoveNext && !hasCommittedRef.current) {
          navigator.vibrate?.(50);
          onMoveNext(task.id);
          hasCommittedRef.current = true;
        } else if (deltaX < 0 && canMovePrev && !hasCommittedRef.current) {
          navigator.vibrate?.(50);
          onMovePrev(task.id);
          hasCommittedRef.current = true;
        } else {
          // Direction blocked or already committed — bounce back
          applyTransform(0);
        }
      } else {
        // Didn't reach threshold — bounce back
        applyTransform(0);
      }

      isSwipingRef.current = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    },
    [task.id, canMoveNext, canMovePrev, onMoveNext, onMovePrev, onTap, applyTransform]
  );

  // --- Touch handlers ---
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      beginGesture(e.touches[0].clientX, e.touches[0].clientY);
    },
    [beginGesture]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY, false);
    },
    [handlePointerMove]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      endGesture(e.changedTouches[0].clientX, e.changedTouches[0].clientY, false);
    },
    [endGesture]
  );

  // --- Mouse handlers (for desktop debugging) ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      beginGesture(e.clientX, e.clientY);

      const onMouseMove = (ev: MouseEvent) => {
        handlePointerMove(ev.clientX, ev.clientY, true);
      };

      const onMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        endGesture(ev.clientX, ev.clientY, true);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [beginGesture, handlePointerMove, endGesture]
  );

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={`Задача ${task.full_id}. Свайп вправо для перемещения в следующую колонку, влево — в предыдущую.`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      style={{
        willChange: 'transform',
        touchAction: 'pan-y',
        cursor: 'grab',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <TaskCard task={task} />
    </div>
  );
}

// Memoize to prevent re-renders when props are referentially stable
export const SwipeableTaskCard = memo(SwipeableTaskCardInner);