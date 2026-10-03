'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { InitResponse } from '../../types/api';
import { markPerf } from '@/lib/perf/timings';
import { shouldUseCachedInit, waitForTelegramWebApp } from '@/lib/telegramSdk';

// ── Telegram Web App extended types ────────────────────────────────────────

interface TelegramWebAppExtended extends Window {
  Telegram?: {
    WebApp: {
      ready: () => void;
      expand: () => void;
      close: () => void;
      isExpanded: boolean;
      viewportHeight: number;
      viewportStableHeight: number;
      requestFullscreen: () => void;
      exitFullscreen: () => void;
      isFullscreen: boolean;
      MainButton: {
        setText: (text: string) => void;
        show: () => void;
        hide: () => void;
        onClick: (callback: () => void) => void;
        offClick: (callback: () => void) => void;
        setActive: (active: boolean) => void;
        setColor: (color: string) => void;
        setTextColor: (color: string) => void;
        isVisible: boolean;
      };
      BackButton: {
        show: () => void;
        hide: () => void;
        onClick: (callback: () => void) => void;
        offClick: (callback: () => void) => void;
        isVisible: boolean;
      };
      onEvent: (eventName: string, eventCallback: (...args: any[]) => void) => void;
      offEvent: (eventName: string, eventCallback: (...args: any[]) => void) => void;
      initData: string;
      initDataUnsafe: {
        user?: Record<string, unknown>;
        auth_date?: string;
        hash?: string;
        query_id?: string;
        start_param?: string; // WS-06: referral code from deep link
      };
      switchInlineQuery: (query: string, chat_types?: string[]) => void;
      openLink: (url: string, options?: { try_open_browser: boolean }) => boolean;
      openTelegramLink: (url: string) => void;
      /** Bot API 7.7+: нативное скачивание хост-приложением (без навигации).
       *  Возвращает false при отказе (версия клиента / невалидный URL). */
      downloadFile?: (url: string, file_name: string) => boolean;
      HapticFeedback: {
        impactOccurred: (impactType: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        notificationOccurred: (notificationType: 'error' | 'success' | 'warning') => void;
        selectionChanged: () => void;
      };
      ThemeParams: Record<string, unknown>;
      State: Record<string, unknown>;
    };
  };
}

type EventName =
  | 'viewportChanged'
  | 'viewportChangedOnce'
  | 'mainButtonClicked'
  | 'backButtonClicked'
  | 'themeChanged'
  | 'memberAddedToChat'
  | 'chatAddedToHomeScreen'
  | 'homeScreenAdded'
  | 'invoiceUpdated'
  | 'fullscreen'
  | 'fullscreenFailed'
  | 'secureValueDataAdded'
  | 'secureValueDataEdited'
  | 'secureValueDataDeleted';

// ── Auth helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'onitask_auth';

function loadFromStorage(): InitResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(data: InitResponse): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Stable empty defaults for SSR-safe initial render ──────────────────────

const EMPTY_USER = Object.freeze({});
const EMPTY_UNSAFE: NonNullable<TelegramWebAppExtended['Telegram']>['WebApp']['initDataUnsafe'] = Object.freeze({});

// ── Boot helpers (shared across hook instances) ─────────────────────────────
//
// PERF-05: useTelegramAuth() вызывают 5 независимых компонентов (page,
// AuthLoader, AiTaskCreator, DataProvider, TelegramProvider) — каждый со своим
// state и своим useEffect. До фикса это давало 5 параллельных POST /api/init
// на холодном старте. Теперь все инстансы ждут ОДИН общий промис.

const NOT_IN_TWA = 'not_in_twa';

type InitOutcome = { ok: true; data: InitResponse } | { ok: false; error: string };

// PERF-03: ожидание загрузки Telegram SDK (waitForTelegramWebApp) вынесено в
// src/lib/telegramSdk.ts; boot-цепочка авторизации использует его до запуска
// /api/init, который разрешает task/flow/invite launch context.

let initInFlight: Promise<InitOutcome> | null = null;

async function requestInit(useCache: boolean): Promise<InitOutcome> {
  markPerf('init:start');

  const tg = await waitForTelegramWebApp();
  if (!tg) return { ok: false, error: 'sdk_unavailable' };

  const initData = tg.initData;
  if (!initData) return { ok: false, error: NOT_IN_TWA };

  markPerf('init:data-ready');

  try {
    const startParam = tg.initDataUnsafe?.start_param || '';

    // Auth cache is valid only for a normal launch. A deep link (including
    // an invite code) must always reach /api/init, even if this Telegram
    // WebView already has cached auth data.
    if (shouldUseCachedInit(startParam, useCache)) {
      const cached = loadFromStorage();
      if (cached) return { ok: true, data: cached };
    }

    const res = await fetch('/api/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, start_param: startParam }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      const errorMsg = errData.error || errData.message || 'init_failed';
      // Prefix with HTTP status code for client-side error differentiation (fixes #7)
      throw new Error(`${res.status}:${errorMsg}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'init_failed');
    }

    const data = json.data as InitResponse;
    saveToStorage(data);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'init_error' };
  }
}

/** Общий in-flight промис; `force` — новый запрос (refresh после onboarding). */
function fetchInitOnce(force = false): Promise<InitOutcome> {
  if (force) initInFlight = null;
  if (!initInFlight) {
    const pending = requestInit(!force);
    initInFlight = pending;
    void pending.then((outcome) => {
      // Retry / следующий hook instance должен получить новую попытку.
      if (!outcome.ok && initInFlight === pending) initInFlight = null;
    });
  }
  return initInFlight;
}

// ── Combined hook ────────────────────────────────────────────────────────

export interface UseTelegramAuthReturn {
  // --- From useTelegram ---
  /** Signal Telegram Web App that it is ready to display */
  ready: () => void;
  /** Expand Web App to full height */
  expand: () => void;
  /** Request fullscreen mode (if supported by client) */
  requestFullscreen: () => void;
  /** Exit fullscreen mode */
  exitFullscreen: () => void;
  /** Close the Web App */
  close: () => void;
  /** Whether the app is currently expanded */
  isExpanded: boolean;
  /** Current viewport height */
  viewportHeight: number;
  /** Stable viewport height (excluding animated parts) */
  viewportStableHeight: number;
  /** Whether the app is in fullscreen mode */
  isFullscreen: boolean;
  /** MainButton (bottom button) helpers */
  mainButton: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
    setActive: (active: boolean) => void;
    setColor: (color: string) => void;
    setTextColor: (color: string) => void;
    isVisible: boolean;
  };
  /** BackButton (top-left button) helpers */
  backButton: {
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
    isVisible: boolean;
  };
  /** Access raw initData for authentication */
  initData: string;
  /** Access raw initDataUnsafe parsed object */
  initDataUnsafe: NonNullable<TelegramWebAppExtended['Telegram']>['WebApp']['initDataUnsafe'];
  /** Referral code from Telegram Mini App deep link (start_param) */
  startParam: string | null;
  /** Fire haptic feedback */
  triggerHaptic: (type: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  /** Subscribe to a Telegram WebApp event */
  onEvent: (name: EventName, callback: (...args: any[]) => void) => void;
  /** Unsubscribe from a Telegram WebApp event */
  offEvent: (name: EventName, callback: (...args: any[]) => void) => void;
  /** Whether Telegram WebApp is available */
  isAvailable: boolean;

  // --- From useAuth ---
  /** Whether auth is being fetched */
  isLoading: boolean;
  /** Error message or null */
  error: string | null;
  /** Auth data (worker info) */
  data: InitResponse | null;
  /** Whether the Telegram WebApp environment is available */
  isTWA: boolean;
  /** Refresh auth data (force re-call /api/init) */
  refresh: () => Promise<void>;
}

export function useTelegramAuth(): UseTelegramAuthReturn {
  // ── State from useTelegram ────────────────────────────────────────────
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportStableHeight, setViewportStableHeight] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [initData, setInitData] = useState('');
  const [initDataUnsafe, setInitDataUnsafe] = useState<NonNullable<TelegramWebAppExtended['Telegram']>['WebApp']['initDataUnsafe']>(EMPTY_UNSAFE);

  const [sdkReady, setSdkReady] = useState(false);
  const tgRef = useRef<NonNullable<NonNullable<TelegramWebAppExtended['Telegram']>['WebApp']> | null>(null);
  const tgInitRanRef = useRef(false);
  const authInitRanRef = useRef(false);

  const prevInitDataRef = useRef<string>('');
  const prevInitDataUnsafeRef = useRef<Record<string, unknown>>(EMPTY_UNSAFE);
  const prevIsExpandedRef = useRef<boolean>(false);
  const prevViewportHeightRef = useRef<number>(0);
  const prevViewportStableHeightRef = useRef<number>(0);
  const prevIsFullscreenRef = useRef<boolean>(false);

  // ── State from useAuth ────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InitResponse | null>(null);
  const [isTWA, setIsTWA] = useState(false);
  const dataRef = useRef<InitResponse | null>(null);

  // ── Telegram Web App initialization ───────────────────────────────────

  const performInit = useCallback(async (options?: { force?: boolean }) => {
    setIsLoading(true);

    // PERF-05: все инстансы хука ждут общий промис (fetchInitOnce) вместо
    // собственного POST /api/init — на холодном старте было 5 параллельных
    // запросов и 5 независимых состояний загрузки.
    const outcome = await fetchInitOnce(options?.force);

    if (outcome.ok) {
      dataRef.current = outcome.data;
      setData(outcome.data);
      setError(null);
      setIsTWA(true);
    } else {
      setError(outcome.error);
      setData(null);
      setIsTWA(outcome.error !== NOT_IN_TWA);
    }

    markPerf('init:done');
    setIsLoading(false);
  }, []);

  /** refresh() после onboarding обязан сходить в сеть заново (force). */
  const refreshAuth = useCallback(() => performInit({ force: true }), [performInit]);

  // Run auth init once on mount: cached normal launches and all deep links
  useEffect(() => {
    if (authInitRanRef.current) return;
    authInitRanRef.current = true;

    // requestInit сам использует sessionStorage только при запуске без
    // start_param. Deep link всегда идёт в сеть, чтобы не потерять invite.
    void performInit();
  }, [performInit]);

  // PERF-03: telegram-web-app.js грузится afterInteractive (не блокирует рендер),
  // поэтому появление SDK отслеживается отдельным эффектом. Раньше window.Telegram
  // читался синхронно на mount: при задержке CDN isAvailable навсегда оставался
  // false, а init падал в ложный экран «Откройте приложение через Telegram WebApp».
  useEffect(() => {
    if (sdkReady) return;
    let cancelled = false;

    void waitForTelegramWebApp().then((tg) => {
      if (!cancelled && tg) setSdkReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [sdkReady]);

  // ── Telegram Web App initialization ───────────────────────────────────

  useEffect(() => {
    if (!sdkReady) return; // SDK ещё не загрузился
    if (tgInitRanRef.current) return;
    tgInitRanRef.current = true;

    const tg = (window as unknown as TelegramWebAppExtended).Telegram?.WebApp ?? null;

    if (!tg) {
      setIsAvailable(false);
      return;
    }

    setIsAvailable(true);
    tgRef.current = tg;

    // 1. Signal that the Web App is ready
    tg.ready();

    // 2. Expand to full available height
    tg.expand();

    // 3. Request fullscreen mode (graceful degradation if not supported)
    if (typeof tg.requestFullscreen === 'function') {
      try {
        tg.requestFullscreen();
      } catch {
        // Some Telegram clients/browsers don't support fullscreen
        // This is non-critical — expand() already provides max height
      }
    }

    // 4. Initialize state from current values (only if actually changed)
    const currentInitData = tg.initData || '';
    const currentInitDataUnsafe = tg.initDataUnsafe || EMPTY_UNSAFE;

    if (currentInitData !== prevInitDataRef.current) {
      prevInitDataRef.current = currentInitData;
      setInitData(currentInitData);
    }
    if (currentInitDataUnsafe !== prevInitDataUnsafeRef.current) {
      prevInitDataUnsafeRef.current = currentInitDataUnsafe;
      setInitDataUnsafe(currentInitDataUnsafe);
    }
    if (tg.isExpanded !== prevIsExpandedRef.current) {
      prevIsExpandedRef.current = tg.isExpanded;
      setIsExpanded(tg.isExpanded);
    }
    if (tg.viewportHeight !== prevViewportHeightRef.current) {
      prevViewportHeightRef.current = tg.viewportHeight;
      setViewportHeight(tg.viewportHeight);
    }
    if (tg.viewportStableHeight !== prevViewportStableHeightRef.current) {
      prevViewportStableHeightRef.current = tg.viewportStableHeight;
      setViewportStableHeight(tg.viewportStableHeight);
    }
    if ((tg.isFullscreen || false) !== prevIsFullscreenRef.current) {
      prevIsFullscreenRef.current = tg.isFullscreen || false;
      setIsFullscreen(tg.isFullscreen || false);
    }

    // 5. Subscribe to viewport changes.
    // Пропускаем промежуточные кадры анимации клавиатуры (isStateStable=false):
    // каждый viewportChanged сейчас делает setState → ре-рендер всего дерева
    // посреди анимации → джиттер при фокусе на любом поле. Обновляем React-стейт
    // только на финальном, стабильном кадре; CSS-переменные (--tg-viewport-*)
    // живут отдельно в TelegramThemeProvider и обновляются на каждый кадр без
    // ре-рендера.
    const handleViewportChange = (e?: { isStateStable?: boolean }) => {
      if (e && e.isStateStable === false) return;
      if (tgRef.current) {
        const newExpanded = tgRef.current.isExpanded;
        const newViewportHeight = tgRef.current.viewportHeight;
        const newViewportStableHeight = tgRef.current.viewportStableHeight;

        if (newExpanded !== prevIsExpandedRef.current) {
          prevIsExpandedRef.current = newExpanded;
          setIsExpanded(newExpanded);
        }
        if (newViewportHeight !== prevViewportHeightRef.current) {
          prevViewportHeightRef.current = newViewportHeight;
          setViewportHeight(newViewportHeight);
        }
        if (newViewportStableHeight !== prevViewportStableHeightRef.current) {
          prevViewportStableHeightRef.current = newViewportStableHeight;
          setViewportStableHeight(newViewportStableHeight);
        }
      }
    };

    tg.onEvent('viewportChanged', handleViewportChange);

    // 6. Subscribe to fullscreen changes
    const handleFullscreen = () => {
      const newFullscreen = tgRef.current?.isFullscreen || false;
      if (newFullscreen !== prevIsFullscreenRef.current) {
        prevIsFullscreenRef.current = newFullscreen;
        setIsFullscreen(newFullscreen);
      }
    };
    tg.onEvent('fullscreen', handleFullscreen);
    const handleFullscreenFailed = () => {
      if (prevIsFullscreenRef.current !== false) {
        prevIsFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    };
    tg.onEvent('fullscreenFailed', handleFullscreenFailed);

    // Cleanup on unmount
    return () => {
      if (tgRef.current) {
        tgRef.current.offEvent('viewportChanged', handleViewportChange);
        tgRef.current.offEvent('fullscreen', handleFullscreen);
        tgRef.current.offEvent('fullscreenFailed', handleFullscreenFailed);
      }
    };
  }, [sdkReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Callbacks ─────────────────────────────────────────────────────────

  const ready = useCallback(() => {
    tgRef.current?.ready();
  }, []);

  const expand = useCallback(() => {
    tgRef.current?.expand();
  }, []);

  const requestFullscreen = useCallback(() => {
    if (typeof tgRef.current?.requestFullscreen === 'function') {
      try {
        tgRef.current.requestFullscreen();
      } catch {
        // Non-critical fallback
      }
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    if (typeof tgRef.current?.exitFullscreen === 'function') {
      try {
        tgRef.current.exitFullscreen();
      } catch {
        // Non-critical fallback
      }
    }
  }, []);

  const close = useCallback(() => {
    tgRef.current?.close();
  }, []);

  const triggerHaptic = useCallback(
    (type: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => {
      tgRef.current?.HapticFeedback?.impactOccurred(type);
    },
    [],
  );

  const onEvent = useCallback((name: EventName, callback: (...args: any[]) => void) => {
    tgRef.current?.onEvent(name, callback);
  }, []);

  const offEvent = useCallback((name: EventName, callback: (...args: any[]) => void) => {
    tgRef.current?.offEvent(name, callback);
  }, []);

  // Memoise the callback refs so they are referentially stable across renders
  const mainButton = useMemo(() => ({
    setText: (text: string) => tgRef.current?.MainButton.setText(text),
    show: () => tgRef.current?.MainButton.show(),
    hide: () => tgRef.current?.MainButton.hide(),
    onClick: (callback: () => void) => tgRef.current?.MainButton.onClick(callback),
    offClick: (callback: () => void) => tgRef.current?.MainButton.offClick(callback),
    setActive: (active: boolean) => tgRef.current?.MainButton.setActive(active),
    setColor: (color: string) => tgRef.current?.MainButton.setColor(color),
    setTextColor: (color: string) => tgRef.current?.MainButton.setTextColor(color),
    isVisible: tgRef.current?.MainButton.isVisible || false,
  }), []);

  const backButton = useMemo(() => ({
    show: () => tgRef.current?.BackButton.show(),
    hide: () => tgRef.current?.BackButton.hide(),
    onClick: (callback: () => void) => tgRef.current?.BackButton.onClick(callback),
    offClick: (callback: () => void) => tgRef.current?.BackButton.offClick(callback),
    isVisible: tgRef.current?.BackButton.isVisible || false,
  }), []);

  // ── Return ────────────────────────────────────────────────────────────

  // Stable reference for auth data
  const stableData = dataRef.current;

  // Memoise the entire return object so consumers get a stable reference
  return useMemo(() => ({
    // From useTelegram
    ready,
    expand,
    requestFullscreen,
    exitFullscreen,
    close,
    isExpanded,
    viewportHeight,
    viewportStableHeight,
    isFullscreen,
    mainButton,
    backButton,
    initData,
    initDataUnsafe: initDataUnsafe || EMPTY_UNSAFE,
    startParam: initDataUnsafe?.start_param || null,
    triggerHaptic,
    onEvent,
    offEvent,
    isAvailable,

    // From useAuth
    isLoading,
    error,
    data: stableData,
    isTWA,
    refresh: refreshAuth,
  }), [ready, expand, requestFullscreen, exitFullscreen, close, isExpanded, viewportHeight,
    viewportStableHeight, isFullscreen, mainButton, backButton, initData, initDataUnsafe,
    triggerHaptic, onEvent, offEvent, isAvailable, isLoading, error, stableData, isTWA, refreshAuth]);
}