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
 * Производительность:
 * - Позиция (--swipe-x) и прогресс (--swipe-progress) пишутся напрямую в DOM через
 *   requestAnimationFrame + CSS-переменные — НЕТ React re-render на каждый кадр.
 * - React state используется только для редких переходов (isSwiping / isExiting).
 *
 * Анимация: 300ms, cubic-bezier(0.25, 0.46, 0.45, 0.94) — Telegram-style ease-out
 *
 * Tap vs Swipe disambiguation (fixed 2026-08-10):
 * - MIN_SWIPE_MOVE (12px): minimum horizontal movement before we consider it a swipe gesture
 * - TAP_DEBOUNCE_MS (150ms): delay before firing onTap so rapid touches don't trigger swipes
 * - VERTICAL_SCROLL_THRESHOLD (5px): deltaY that cancels tap timer and treats gesture as scroll
 * - hasMovedRef: tracks whether MIN_SWIPE_MOVE was exceeded during this gesture
 * - hasScrolledRef: tracks whether VERTICAL_SCROLL_THRESHOLD was exceeded during this gesture
 */

const SWIPE_THRESHOLD = 100; // px — distance needed to trigger swipe (raised from 80)
const SWIPE_MAX_TIME = 500; // ms — max time for fast-swipe detection
const MIN_SWIPE_MOVE = 12; // px — minimum horizontal movement to consider it a swipe, not a tap
const TAP_DEBOUNCE_MS = 150; // ms — delay before firing onTap to allow swipe gesture to be ruled out
const VERTICAL_SCROLL_THRESHOLD = 5; // px — deltaY that cancels tap timer and treats gesture as scroll
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
  const cardRef = useRef<HTMLDivElement>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [translateX, setTranslateX] = useState(0); // only for the one-shot exit animation
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const isSwipingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const exitedRef = useRef(false);
  const hasVibratedAt50Ref = useRef(false); // track 50% haptic per swipe gesture
  const deltaXRef = useRef(0); // declared before the exit effect that reads it
  const tapTimerRef = useRef<number | null>(null); // timer for debouncing onTap
  const hasMovedRef = useRef(false); // tracks whether minimum swipe distance was exceeded
  const hasScrolledRef = useRef(false); // tracks whether vertical scroll threshold was exceeded

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

  // Apply drag offset + progress directly to the DOM inside rAF — no React
  // re-render per frame, keeps the card smooth even on low-end devices.
  const applyDrag = useCallback((x: number, progress: number) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = cardRef.current;
      if (!el) return;
      el.style.setProperty('--swipe-x', `${x}px`);
      el.style.setProperty('--swipe-progress', String(progress));
    });
  }, []);

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

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (exitedRef.current) return;
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      startTime.current = Date.now();
      isSwipingRef.current = false;
      setIsSwiping(false);
      applyDrag(0, 0);
      hasVibratedAt50Ref.current = false;
      hasMovedRef.current = false;
      hasScrolledRef.current = false;
      // Cancel any pending tap — we're about to decide if this is a swipe
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
    },
    [applyDrag]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (exitedRef.current) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = Math.abs(touch.clientY - startY.current);

      // --- Vertical scroll guard: cancel tap timer immediately ---
      if (!hasScrolledRef.current && deltaY > VERTICAL_SCROLL_THRESHOLD) {
        hasScrolledRef.current = true;
        // Clear tap timer so it won't fire after this scroll gesture
        if (tapTimerRef.current) {
          clearTimeout(tapTimerRef.current);
          tapTimerRef.current = null;
        }
      }

      // If vertical movement dominates early on — ignore it (user scrolling)
      if (!isSwipingRef.current && !hasMovedRef.current && deltaY > Math.abs(deltaX) && Math.abs(deltaX) < 10) {
        return;
      }

      // Track minimum horizontal movement to distinguish swipe from tap
      if (!hasMovedRef.current && Math.abs(deltaX) >= MIN_SWIPE_MOVE) {
        hasMovedRef.current = true;
      }

      // Only enter swipe mode once minimum movement threshold is crossed
      if (!isSwipingRef.current && hasMovedRef.current) {
        isSwipingRef.current = true;
        setIsSwiping(true);
      }

      if (isSwipingRef.current) {
        // Ограничиваем движение, если свайп не в разрешённом направлении
        const direction = deltaX > 0 ? 'next' : 'prev';
        const allowed =
          (direction === 'next' && canMoveNext) || (direction === 'prev' && canMovePrev);

        if (!allowed) {
          applyDrag(0, 0);
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

        // Haptic feedback at 50% progress (light tap)
        if (progress > 0.5 && !hasVibratedAt50Ref.current) {
          navigator.vibrate?.(10);
          hasVibratedAt50Ref.current = true;
        }

        applyDrag(clampedDelta, progress);
      }
    },
    [canMoveNext, canMovePrev, applyDrag]
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

      // If the user scrolled vertically — treat as scroll, do NOT fire onTap
      if (hasScrolledRef.current) {
        isSwipingRef.current = false;
        setIsSwiping(false);
        hasMovedRef.current = false;
        hasScrolledRef.current = false;
        return;
      }

      // If the user barely moved (didn't exceed MIN_SWIPE_MOVE), treat as tap
      // and debounce it so rapid touches don't accidentally trigger swipes
      if (!isSwipingRef.current || !hasMovedRef.current) {
        // Clear any pending swipe-related state
        isSwipingRef.current = false;
        setIsSwiping(false);
        hasMovedRef.current = false;

        // Debounce tap to give the swipe gesture window time to resolve
        tapTimerRef.current = window.setTimeout(() => {
          tapTimerRef.current = null;
          onTap(task.id);
        }, TAP_DEBOUNCE_MS);
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
          applyDrag(0, 0);
          setIsSwiping(false);
          isSwipingRef.current = false;
        }
      } else {
        // Не дошли до порога — bounce-back
        applyDrag(0, 0);
        setIsSwiping(false);
        isSwipingRef.current = false;
        hasMovedRef.current = false;
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
      applyDrag,
    ]
  );

  // Системный жест прервал свайп (уведомление, навигация) — сбрасываем состояние
  const handleTouchCancel = useCallback(() => {
    cleanup();
    if (exitedRef.current) return;
    isSwipingRef.current = false;
    setIsSwiping(false);
    hasMovedRef.current = false;
    hasScrolledRef.current = false;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    applyDrag(0, 0);
  }, [cleanup, applyDrag]);

  // Обработка мыши для десктопной отладки — sync with touch logic
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (exitedRef.current) return;
      startX.current = e.clientX;
      startY.current = e.clientY;
      startTime.current = Date.now();
      isSwipingRef.current = false;
      setIsSwiping(false);
      applyDrag(0, 0);
      hasVibratedAt50Ref.current = false;
      hasMovedRef.current = false;
      hasScrolledRef.current = false;
      // Cancel any pending tap
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }

      const handleMouseMove = (ev: MouseEvent) => {
        if (exitedRef.current) return;
        const deltaX = ev.clientX - startX.current;
        const deltaY = Math.abs(ev.clientY - startY.current);

        // --- Vertical scroll guard: cancel tap timer immediately ---
        if (!hasScrolledRef.current && deltaY > VERTICAL_SCROLL_THRESHOLD) {
          hasScrolledRef.current = true;
          if (tapTimerRef.current) {
            clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
          }
        }

        // Ignore vertical scrolling gestures
        if (!isSwipingRef.current && !hasMovedRef.current && deltaY > Math.abs(deltaX) && Math.abs(deltaX) < 10) {
          return;
        }

        // Track minimum horizontal movement
        if (!hasMovedRef.current && Math.abs(deltaX) >= MIN_SWIPE_MOVE) {
          hasMovedRef.current = true;
        }

        // Only enter swipe mode once minimum movement threshold is crossed
        if (!isSwipingRef.current && hasMovedRef.current) {
          isSwipingRef.current = true;
          setIsSwiping(true);
        }

        if (isSwipingRef.current) {
          const direction = deltaX > 0 ? 'next' : 'prev';
          const allowed =
            (direction === 'next' && canMoveNext) || (direction === 'prev' && canMovePrev);

          if (!allowed) {
            applyDrag(0, 0);
            return;
          }

          const maxDrag = 120;
          const clampedDelta =
            Math.abs(deltaX) > maxDrag
              ? Math.sign(deltaX) * (maxDrag + (Math.abs(deltaX) - maxDrag) * 0.2)
              : deltaX;

          // Progressive feedback: compute progress toward threshold
          const progress = Math.min(Math.abs(clampedDelta) / SWIPE_THRESHOLD, 1);

          // Haptic feedback at 50% progress (desktop browsers may not support vibrate)
          if (progress > 0.5 && !hasVibratedAt50Ref.current) {
            navigator.vibrate?.(10);
            hasVibratedAt50Ref.current = true;
          }

          applyDrag(clampedDelta, progress);
        }
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        if (exitedRef.current) return;

        const deltaX = ev.clientX - startX.current;
        const elapsed = Date.now() - startTime.current;

        // If the user scrolled vertically — treat as scroll, do NOT fire onTap
        if (hasScrolledRef.current) {
          isSwipingRef.current = false;
          setIsSwiping(false);
          hasMovedRef.current = false;
          hasScrolledRef.current = false;
          return;
        }

        // If the user barely moved (didn't exceed MIN_SWIPE_MOVE), treat as tap
        // and debounce it so rapid clicks don't accidentally trigger swipes
        if (!isSwipingRef.current || !hasMovedRef.current) {
          isSwipingRef.current = false;
          setIsSwiping(false);
          hasMovedRef.current = false;

          tapTimerRef.current = window.setTimeout(() => {
            tapTimerRef.current = null;
            onTap(task.id);
          }, TAP_DEBOUNCE_MS);
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
            applyDrag(0, 0);
          }
        } else {
          applyDrag(0, 0);
        }

        setIsSwiping(false);
        isSwipingRef.current = false;
        hasMovedRef.current = false;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [task.id, canMoveNext, canMovePrev, onMoveNext, onMovePrev, onTap, triggerSwipeExit, applyDrag]
  );

  // Progressive visual feedback via CSS variables — no JS recompute per frame.
  // At 0% progress: opacity 0.6, scale 0.97 (card "dims" at start of drag)
  // At 100% progress: opacity 1.0, scale 1.0 (card "wakes up" near threshold)
  const cardStyle: React.CSSProperties = {
    transform: isExiting
      ? `translateX(${translateX}px) scale(1)`
      : isSwiping
        ? 'translateX(var(--swipe-x, 0px)) scale(calc(0.97 + var(--swipe-progress, 0) * 0.03))'
        : 'translateX(var(--swipe-x, 0px)) scale(1)',
    transition: isSwiping
      ? 'none'
      : isExiting
        ? `transform ${SWIPE_EXIT_DURATION}ms ${EXIT_EASING}, opacity ${SWIPE_EXIT_DURATION}ms ${EXIT_EASING}`
        : `transform 0.3s ${BOUNCE_EASING}, opacity 0.3s ${BOUNCE_EASING}`,
    touchAction: 'pan-y',
    cursor: 'pointer',
    opacity: isExiting ? 0 : 'calc(0.6 + var(--swipe-progress, 0) * 0.4)',
    pointerEvents: isExiting ? 'none' : 'auto',
    willChange: 'transform, opacity',
  };

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={`Задача ${task.full_id}. Свайп вправо для перемещения в следующую колонку, влево — в предыдущую.`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onMouseDown={handleMouseDown}
      style={cardStyle}
    >
      <TaskCard task={task} />
    </div>
  );
}