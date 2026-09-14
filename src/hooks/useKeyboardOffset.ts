'use client';

import { useEffect } from 'react';

/**
 * useKeyboardOffset
 *
 * Writes the on-screen keyboard coverage as a CSS custom property
 * (`--kb-offset`) onto `document.documentElement`, updated on every
 * `visualViewport` frame — no React re-render per frame (the same approach
 * BottomSheet already uses for `--sheet-y` during drag).
 *
 * Why this exists: Telegram/iOS keyboard-dismiss is animated, and during it
 * `position:fixed` elements whose containing block has `overflow:hidden`
 * (BottomSheet sets `body { overflow:hidden }` while open) can detach from the
 * *visual* viewport and "hang" while BottomMenu descends. The result: the amber
 * CTA near the sheet's bottom edge flashes exposed.
 *
 * BottomSheet, when `respectKeyboard` is on, reads `var(--kb-offset)` and lifts
 * its panel so it lowers *together* with the keyboard animation.
 *
 * Intentionally NOT using `useTelegramAuth`'s `viewportHeight`/`viewportStableHeight`
 * React state: that state is throttled to stable frames (`isStateStable`), which
 * is exactly the lag we're removing. Here we read the live `tg` property (the
 * value updates every frame; only the `viewportChanged` *event* is throttled)
 * and pair it with `visualViewport` events for per-frame updates.
 */

type TgWebApp = {
  viewportHeight?: number;
  viewportStableHeight?: number;
  onEvent?: (name: string, cb: (e?: { isStateStable?: boolean }) => void) => void;
  offEvent?: (name: string, cb: (e?: { isStateStable?: boolean }) => void) => void;
};

const KB_VAR = '--kb-offset';

const getRoot = () => (window as unknown as { Telegram?: { WebApp?: TgWebApp } })?.Telegram?.WebApp;

export function computeKeyboardOffset(): number {
  const tg = getRoot();
  if (
    tg &&
    typeof tg.viewportHeight === 'number' &&
    typeof tg.viewportStableHeight === 'number'
  ) {
    // tg.viewportHeight is the LIVE visible height (property updates each
    // frame); viewportStableHeight is the keyboard-closed height.
    return Math.max(0, tg.viewportStableHeight - tg.viewportHeight);
  }
  const vv = window.visualViewport;
  if (vv) {
    // Fallback for TWA WebView without Telegram's viewport API.
    return Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
  }
  return 0;
}

export function useKeyboardOffset(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty(KB_VAR, `${computeKeyboardOffset()}px`);
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    const tg = getRoot();
    if (tg) tg.onEvent?.('viewportChanged', apply);
    window.addEventListener('resize', apply);

    apply();
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      tg?.offEvent?.('viewportChanged', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
}
