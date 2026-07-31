"use client";

import { useTelegramViewport } from "@/hooks/useTelegramViewport";

/**
 * Mount once in the root layout. Split into its own file specifically so
 * the "use client" boundary doesn't spread up into layout.tsx — Next.js
 * only reads `viewport`/`metadata` exports from Server Components.
 */
export function TelegramViewportBridge() {
  useTelegramViewport();
  return null;
}
