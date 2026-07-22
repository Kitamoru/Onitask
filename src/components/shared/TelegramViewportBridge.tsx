"use client";

import { useTelegramViewport } from "@/hooks/useTelegramViewport";

/**
 * Bridges the Telegram WebApp JS API to the CSS custom properties.
 * Mount this once, high in the tree (app/layout.tsx).
 */
export function TelegramViewportBridge() {
  useTelegramViewport();
  return null;
}