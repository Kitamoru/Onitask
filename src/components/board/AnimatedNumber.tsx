'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * AnimatedNumber — BOARD-AGG UI: мягкая анимация изменения числа.
 *
 * Бест-практисы:
 *  - tween old→new через rAF, 220ms, easeOutCubic — коротко и ненавязчиво;
 *  - анимируется ТОЛЬКО изменение (первый рендер и unchanged — мгновенно);
 *  - retarget из текущего отображаемого значения (быстрые изменения подряд);
 *  - большие прыжки (>15) — без твина, просто смена;
 *  - prefers-reduced-motion → мгновенная подмена;
 *  - рендер через textContent на ref — setState на каждый кадр не дёргает React.
 *
 * Рекомендуется в паре с `tabular-nums` у родителя (нет layout-shift при
 * смене разрядности).
 */

const DURATION_MS = 220;
const MAX_ANIMATED_DELTA = 15;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function AnimatedNumber({ value }: { value: number }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const displayedRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayedRef.current;
    if (from === value) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || Math.abs(value - from) > MAX_ANIMATED_DELTA) {
      displayedRef.current = value;
      if (spanRef.current) spanRef.current.textContent = String(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const current = Math.round(from + (value - from) * easeOutCubic(t));
      displayedRef.current = current;
      if (spanRef.current) spanRef.current.textContent = String(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [value]);

  // SSR/первый рендер — точное значение; далее текст правится через ref.
  return (
    <span ref={spanRef} suppressHydrationWarning>
      {value}
    </span>
  );
}
