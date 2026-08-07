'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TaskCard } from '@/components/stream';
import type { TaskEntity } from '@/types/flowboard';

/**
 * SwipeableTaskCard — обёртка над TaskCard с поддержкой свайпов для перемещения между колонками.
 *
 * Optimistic UI паттерн:
 * - При достижении порога свайпа → карточка мгновенно анимируется за пределы экрана
 * - API вызов идёт в фоне (void, без await)
 * - Колбэк onSwipeAway вызывается после успешного свайпа для удаления карточки из списка
 *
 * Анимация: 300ms, cubic-bezier(0.25, 0.46, 0.45, 0.94) — Telegram-style ease-out
 */

const SWIPE_THRESHOLD = 80; // px — distance needed to trigger swipe
const SWIPE_MAX_TIME = 500; // ms — max time for fast-swipe detection
const SWIPE_EXIT_DURATION = 300; // ms — smooth exit animation (Telegram HIG standard)
// Telegram-style easing: starts fast, decelerates smoothly to rest
const EXIT_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
// Soft bounce-back easing (no overshoot) — Material Design standard
const BOUNCE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export interface SwipeableTaskCardProps {
  task: TaskEntity;
  /** Порядок колонок: ['backlog','in_progress','review','done'] */
  columnOrder: string[];
  /** Колонка, в которой находится задача */
  currentColumn: string;
  /** Перемещение в следующую колонку (optimistic — вызывается мгновенно) */
  onMoveNext: (taskId: string) => void;
  /** Перемещение в предыдущую колонку (optimistic — вызывается мгновенно) */
  onMovePrev: (taskId: string) => void;
  /** Обычный тап по карточке */
  onTap: (taskId: string) => void;
  /** Вызывается когда карточка успешно смахнута — для удаления из локального списка */
  onSwipeAway?: (taskId: string) => void;
}

export function SwipeableTaskCard({
  task,
  columnOrder,
  currentColumn,
  onMoveNext,
  onMovePrev,
  onTap,
  onSwipeAway,
}: SwipeableTaskCardProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [swipeProgress, setSwipeProgress] = useState(0); // 0..1 — how close to threshold
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const isSwipingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const exitedRef = useRef(false);
  const hasVibratedAt50Ref = useRef(false); // track 50% haptic per swipe gesture

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

  // Когда isExiting=true — карточка плавно улетает за экран
  useEffect(() => {
    if (isExiting) {
      requestAnimationFrame(() => {
        // Определяем направление ухода
        const direction = deltaXRef.current;
        setTranslateX(direction > 0 ? 500 : -500);
      });
      // Через анимационное время — вызываем onSwipeAway
      const timer = setTimeout(() => {
        onSwipeAway?.(task.id);
      }, SWIPE_EXIT_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isExiting, onSwipeAway, task.id]);

  const deltaXRef = useRef(0);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (exitedRef.current) return;
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      startTime.current = Date.now();
      isSwipingRef.current = false;
      setIsSwiping(false);
      setTranslateX(0);
      setSwipeProgress(0);
      hasVibratedAt50Ref.current = false;
    },
    []
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (exitedRef.current) return;
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
          setSwipeProgress(0);
          return;
        }

        // Лёгкое сопротивление у края
        const maxDrag = 120;
        const clampedDelta =
          Math.abs(deltaX) > maxDrag
            ? Math.sign(deltaX) * (maxDrag + (Math.abs(deltaX) - maxDrag) * 0.2)
            : deltaX;

        // Progressive feedback: compute progress toward threshold
        const progress = Math.min(Math.abs(clampedDelta) / SWIPE_THRESHOLD, 1);
        setSwipeProgress(progress);

        // Haptic feedback at 50% progress (light tap)
        if (progress > 0.5 && !hasVibratedAt50Ref.current) {
          navigator.vibrate?.(10);
          hasVibratedAt50Ref.current = true;
        }

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          setTranslateX(clampedDelta);
        });
      }
    },
    [canMoveNext, canMovePrev]
  );

  const triggerSwipeExit = useCallback(
    (direction: 'next' | 'prev') => {
      if (exitedRef.current) return;
      exitedRef.current = true;
      setIsSwiping(false);
      setIsExiting(true);
      deltaXRef.current = direction === 'next' ? 1 : -1;
    },
    []
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      cleanup();

      if (exitedRef.current) return;

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
        // Достигли порога — оптимистичный свайп
        if (deltaX > 0 && canMoveNext) {
          navigator.vibrate?.(50);
          onMoveNext(task.id);
          triggerSwipeExit('next');
        } else if (deltaX < 0 && canMovePrev) {
          navigator.vibrate?.(50);
          onMovePrev(task.id);
          triggerSwipeExit('prev');
        } else {
          // Нельзя двигать в этом направлении — откат
          setTranslateX(0);
          setIsSwiping(false);
          isSwipingRef.current = false;
        }
      } else {
        // Не дошли до порога — bounce-back
        setTranslateX(0);
        setIsSwiping(false);
        isSwipingRef.current = false;
      }
    },
    [
      task.id,
      canMoveNext,
      canMovePrev,
      onMoveNext,
      onMovePrev,
      onTap,
      cleanup,
      triggerSwipeExit,
    ]
  );

  // Обработка мыши для десктопной отладки
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (exitedRef.current) return;
      startX.current = e.clientX;
      startY.current = e.clientY;
      startTime.current = Date.now();
      isSwipingRef.current = false;
      setIsSwiping(false);
      setTranslateX(0);
      setSwipeProgress(0);
      hasVibratedAt50Ref.current = false;

      const handleMouseMove = (ev: MouseEvent) => {
        if (exitedRef.current) return;
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
            setSwipeProgress(0);
            return;
          }

          const maxDrag = 120;
          const clampedDelta =
            Math.abs(deltaX) > maxDrag
              ? Math.sign(deltaX) * (maxDrag + (Math.abs(deltaX) - maxDrag) * 0.2)
              : deltaX;

          // Progressive feedback: compute progress toward threshold
          const progress = Math.min(Math.abs(clampedDelta) / SWIPE_THRESHOLD, 1);
          setSwipeProgress(progress);

          // Haptic feedback at 50% progress (desktop browsers may not support vibrate)
          if (progress > 0.5 && !hasVibratedAt50Ref.current) {
            navigator.vibrate?.(10);
            hasVibratedAt50Ref.current = true;
          }

          setTranslateX(clampedDelta);
        }
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        if (exitedRef.current) return;

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
            triggerSwipeExit('next');
          } else if (deltaX < 0 && canMovePrev) {
            onMovePrev(task.id);
            triggerSwipeExit('prev');
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
    [task.id, canMoveNext, canMovePrev, onMoveNext, onMovePrev, onTap, triggerSwipeExit]
  );

  // Progressive visual feedback: opacity and scale based on swipe progress
  // At 0% progress: opacity 0.6, scale 0.97 (card "dims" at start of drag)
  // At 100% progress: opacity 1.0, scale 1.0 (card "wakes up" near threshold)
  const fadeOpacity = 0.6 + swipeProgress * 0.4;
  const pressScale = 0.97 + swipeProgress * 0.03;

  // Bounce-back / exit transition
  const cardStyle: React.CSSProperties = {
    transform: `translateX(${translateX}px) scale(${isSwiping ? pressScale : 1})`,
    transition: isSwiping
      ? 'none'
      : isExiting
        ? `transform ${SWIPE_EXIT_DURATION}ms ${EXIT_EASING}, opacity ${SWIPE_EXIT_DURATION}ms ${EXIT_EASING}`
        : `transform 0.3s ${BOUNCE_EASING}, opacity 0.3s ${BOUNCE_EASING}`,
    touchAction: 'pan-y',
    cursor: 'pointer',
    opacity: isExiting ? 0 : fadeOpacity,
    pointerEvents: isExiting ? 'none' : 'auto',
    willChange: 'transform, opacity',
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