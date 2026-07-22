"use client";

import { useEffect } from "react";

/**
 * Bridges the Telegram WebApp JS API to the CSS custom properties declared
 * in globals.css. Mount this once, high in the tree (e.g. app/layout.tsx).
 *
 * Why this exists instead of just using 100dvh:
 * - Android Telegram's webview sometimes reports viewportHeight smaller
 *   than the actual visible area right after WebApp.expand() resolves;
 *   viewportChanged fires again a beat later with the correct value.
 * - iOS Telegram shrinks the *visual* viewport when the keyboard opens
 *   but dvh does not reliably track that inside Telegram's webview the
 *   way it does in Safari — WebApp.viewportHeight does.
 * - contentSafeAreaInset (Bot API 8.0+) accounts for Telegram's own
 *   floating UI (header pill, expanded Main Button) stacked on top of
 *   the OS notch/home-indicator safe area — plain env(safe-area-inset-*)
 *   alone under-reports the usable inset on those clients.
 *
 * Older clients without these APIs simply never fire the callbacks, and
 * the :root fallback values (100dvh / env(safe-area-inset-*)) apply —
 * safe to run this hook unconditionally, including in plain-browser dev.
 */
export function useTelegramViewport() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();
    tg.expand();
    // Stops an accidental swipe-down over the scrollable form from
    // closing the mini app — only relevant once vertical swipes are
    // supported by the client (Bot API 7.7+), no-op otherwise.
    tg.disableVerticalSwipes?.();

    const root = document.documentElement.style;

    const applyViewport = () => {
      root.setProperty("--tg-viewport-height", `${tg.viewportHeight}px`);
      root.setProperty(
        "--tg-viewport-stable-height",
        `${tg.viewportStableHeight}px`
      );
    };

    const applySafeArea = () => {
      const sa = tg.safeAreaInset;
      const csa = tg.contentSafeAreaInset;
      if (sa) {
        root.setProperty(
          "--tg-safe-area-top",
          `${Math.max(sa.top, 0)}px`
        );
        root.setProperty(
          "--tg-safe-area-bottom",
          `${Math.max(sa.bottom, 0)}px`
        );
      }
      if (csa) {
        root.setProperty("--tg-content-safe-top", `${Math.max(csa.top, 0)}px`);
        root.setProperty(
          "--tg-content-safe-bottom",
          `${Math.max(csa.bottom, 0)}px`
        );
      }
    };

    applyViewport();
    applySafeArea();

    tg.onEvent("viewportChanged", applyViewport);
    tg.onEvent("safeAreaChanged", applySafeArea);
    tg.onEvent("contentSafeAreaChanged", applySafeArea);

    // Match Telegram's own chrome to the card background so there is no
    // light flash of default theme color between native header and page.
    tg.setHeaderColor?.("#0a0a0a");
    tg.setBackgroundColor?.("#0a0a0a");

    return () => {
      tg.offEvent("viewportChanged", applyViewport);
      tg.offEvent("safeAreaChanged", applySafeArea);
      tg.offEvent("contentSafeAreaChanged", applySafeArea);
    };
  }, []);
}

// Minimal ambient typings so this compiles without @types/telegram-web-app.
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        disableVerticalSwipes?: () => void;
        viewportHeight: number;
        viewportStableHeight: number;
        safeAreaInset?: { top: number; bottom: number; left: number; right: number };
        contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        onEvent: (event: string, cb: () => void) => void;
        offEvent: (event: string, cb: () => void) => void;
      };
    };
  }
}