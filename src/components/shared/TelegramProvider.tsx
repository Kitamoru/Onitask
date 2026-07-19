'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';
import { useTelegram } from '@/hooks/useTelegram';

// ── Context types ───────────────────────────────────────────────────────
// Match the shape from useTelegram — user is Record<string, unknown> there
interface TelegramInitDataUnsafe {
  user?: Record<string, unknown>;
  auth_date?: string;
  hash?: string;
  query_id?: string;
  start_param?: string;
}

export interface TelegramContextValue {
  /** Whether Telegram WebApp SDK is available */
  isAvailable: boolean;
  /** Raw initData string (for auth) */
  initData: string;
  /** Parsed init data (user, hash, etc.) */
  initDataUnsafe: TelegramInitDataUnsafe;
  /** Telegram user object if present */
  user: Record<string, unknown> | undefined;
  /** start_param from deep link */
  startParam: string | null;
}

const DEFAULT_CONTEXT: TelegramContextValue = {
  isAvailable: false,
  initData: '',
  initDataUnsafe: {},
  user: undefined,
  startParam: null,
};

const TelegramContext = createContext<TelegramContextValue>(DEFAULT_CONTEXT);

/** Consume Telegram context inside any descendant component */
export function useTelegramContext(): TelegramContextValue {
  return useContext(TelegramContext);
}

/**
 * Client-only provider that wraps the app tree with Telegram WebApp data.
 *
 * - Reads window.Telegram only inside useEffect → no hydration mismatch.
 * - Memoises context value → consumers re-render only when real data changes.
 * - Calls tg.ready() / tg.expand() exactly once via a ref gate.
 */
export function TelegramProvider({ children }: { children: ReactNode }) {
  const tg = useTelegram();

  // Build a stable context value — consumers won't get spurious re-renders
  const value = useMemo<TelegramContextValue>(
    () => ({
      isAvailable: tg.isAvailable,
      initData: tg.initData,
      initDataUnsafe: tg.initDataUnsafe ?? {},
      user: tg.initDataUnsafe?.user,
      startParam: tg.startParam,
    }),
    [tg.isAvailable, tg.initData, tg.initDataUnsafe, tg.startParam],
  );

  return (
    <TelegramContext.Provider value={value}>
      {children}
    </TelegramContext.Provider>
  );
}