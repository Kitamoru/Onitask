"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Grows a textarea's height to fit its content as the user types — the
 * classic "reset to auto, then read scrollHeight" technique.
 *
 * Deliberately NOT using the newer CSS `field-sizing: content` property,
 * which would do this in pure CSS with no JS at all: it's too recent to
 * trust on the older Android WebView builds Telegram's in-app browser
 * can run on — the same compatibility reasoning that moved this project
 * off Tailwind v4's `@property`-based output. This hook's approach is
 * plain DOM measurement + inline style, which has worked in every
 * browser back to IE9; there's nothing here for an old WebView to choke
 * on.
 */
export function useAutosizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first — otherwise the box only ever grows, because
    // scrollHeight of an already-tall textarea never reports a smaller
    // number even after deleting text.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return ref;
}