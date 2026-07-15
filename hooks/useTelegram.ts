// useTelegram hook — Telegram Web App integration
// Provides tg.ready(), tg.expand(), requestFullscreen(), MainButton, BackButton access
// Works in browser environment (TWA) with graceful degradation for SSR/non-Telegram browsers

import { useEffect, useState, useCallback, useRef } from 'react';

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

export interface UseTelegramReturn {
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
  initDataUnsafe: TelegramWebAppExtended['Telegram']['WebApp']['initDataUnsafe'];
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
}

/**
 * Hook providing access to Telegram Web App API.
 * 
 * Features:
 * - Calls tg.ready() and tg.expand() on mount
 * - Requests fullscreen mode via tg.requestFullscreen()
 * - Subscribes to viewportChanged events
 * - Wraps MainButton and BackButton with React-friendly API
 * - Gracefully degrades when not in Telegram (SSR / browser)
 */
export function useTelegram(): UseTelegramReturn {
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportStableHeight, setViewportStableHeight] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  const tgRef = useRef<TelegramWebAppExtended['Telegram']['WebApp'] | null>(null);

  // Get Telegram Web App instance
  useEffect(() => {
    const globalWindow = typeof window !== 'undefined' ? (window as unknown as TelegramWebAppExtended) : null;
    const telegramObj = globalWindow?.Telegram;
    const tg = telegramObj?.WebApp ?? null;

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

    // 4. Initialize state from current values
    setIsExpanded(tg.isExpanded);
    setViewportHeight(tg.viewportHeight);
    setViewportStableHeight(tg.viewportStableHeight);
    setIsFullscreen(tg.isFullscreen || false);

    // 5. Subscribe to viewport changes
    const handleViewportChange = () => {
      if (tgRef.current) {
        setIsExpanded(tgRef.current.isExpanded);
        setViewportHeight(tgRef.current.viewportHeight);
        setViewportStableHeight(tgRef.current.viewportStableHeight);
      }
    };

    tg.onEvent('viewportChanged', handleViewportChange);

    // 6. Subscribe to fullscreen changes
    const handleFullscreen = () => {
      setIsFullscreen(tgRef.current?.isFullscreen || false);
    };
    tg.onEvent('fullscreen', handleFullscreen);
    const handleFullscreenFailed = () => {
      setIsFullscreen(false);
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
  }, []);

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

  return {
    ready,
    expand,
    requestFullscreen,
    exitFullscreen,
    close,
    isExpanded,
    viewportHeight,
    viewportStableHeight,
    isFullscreen,
    mainButton: {
      setText: (text: string) => tgRef.current?.MainButton.setText(text),
      show: () => tgRef.current?.MainButton.show(),
      hide: () => tgRef.current?.MainButton.hide(),
      onClick: (callback: () => void) => tgRef.current?.MainButton.onClick(callback),
      offClick: (callback: () => void) => tgRef.current?.MainButton.offClick(callback),
      setActive: (active: boolean) => tgRef.current?.MainButton.setActive(active),
      setColor: (color: string) => tgRef.current?.MainButton.setColor(color),
      setTextColor: (color: string) => tgRef.current?.MainButton.setTextColor(color),
      isVisible: tgRef.current?.MainButton.isVisible || false,
    },
    backButton: {
      show: () => tgRef.current?.BackButton.show(),
      hide: () => tgRef.current?.BackButton.hide(),
      onClick: (callback: () => void) => tgRef.current?.BackButton.onClick(callback),
      offClick: (callback: () => void) => tgRef.current?.BackButton.offClick(callback),
      isVisible: tgRef.current?.BackButton.isVisible || false,
    },
    initData: tgRef.current?.initData || '',
    initDataUnsafe: tgRef.current?.initDataUnsafe || {},
    startParam: tgRef.current?.initDataUnsafe.start_param || null,
    triggerHaptic,
    onEvent,
    offEvent,
    isAvailable,
  };
}