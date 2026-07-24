"use client";

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";

/**
 * TelegramThemeProvider — Context provider for Telegram WebApp theme + viewport integration.
 *
 * This component:
 * 1. Reads Telegram.WebApp at mount time (theme params + viewport)
 * 2. Applies theme CSS variables to document.documentElement
 * 3. Applies viewport CSS custom properties (--tg-viewport-height, etc.)
 * 4. Adds 'tg-webapp' class to <html> when running inside Telegram
 * 5. Subscribes to themeChanged, viewportChanged, safeAreaChanged events
 * 6. Provides theme state via React context for components that need it
 *
 * Must wrap the app tree (used in layout.tsx) so all child components
 * can access the current Telegram theme values.
 */

interface TelegramThemeContextValue {
  /** Whether we're running inside Telegram WebApp */
  isAvailable: boolean;
  /** Current theme background color */
  bgColor: string;
  /** Current theme text color */
  textColor: string;
  /** Current theme button color */
  buttonColor: string;
  /** Current theme button text color */
  buttonText: string;
}

const DEFAULT_CONTEXT: TelegramThemeContextValue = {
  isAvailable: false,
  bgColor: '#0A0A0A',
  textColor: '#FAFAFA',
  buttonColor: '#F59E0B',
  buttonText: '#FFFFFF',
};

const TelegramThemeContext = createContext<TelegramThemeContextValue>(DEFAULT_CONTEXT);

export function useTelegramThemeContext(): TelegramThemeContextValue {
  return useContext(TelegramThemeContext);
}

export function TelegramThemeProvider({ children }: { children: ReactNode }) {
  const [contextValue, setContextValue] = useState<TelegramThemeContextValue>(DEFAULT_CONTEXT);
  const contextValueRef = useRef<TelegramThemeContextValue>(DEFAULT_CONTEXT);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    // Initialize: ready + expand + disable swipes
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();

    // Match Telegram's own chrome to the card background
    tg.setHeaderColor?.('#0a0a0a');
    tg.setBackgroundColor?.('#0a0a0a');

    const root = document.documentElement.style;
    const htmlEl = document.documentElement;

    // Read initial theme params
    const tp = tg.themeParams || {};
    const value: TelegramThemeContextValue = {
      isAvailable: true,
      bgColor: tp.bg_color || DEFAULT_CONTEXT.bgColor,
      textColor: tp.text_color || DEFAULT_CONTEXT.textColor,
      buttonColor: tp.button_color || DEFAULT_CONTEXT.buttonColor,
      buttonText: tp.button_text_color || DEFAULT_CONTEXT.buttonText,
    };

    // Apply theme CSS custom properties
    root.setProperty('--tg-theme-bg-color', value.bgColor);
    root.setProperty('--tg-theme-text-color', value.textColor);
    root.setProperty('--tg-theme-button-color', value.buttonColor);
    root.setProperty('--tg-theme-button-text-color', value.buttonText);

    // Add tg-webapp class to html for CSS targeting
    htmlEl.classList.add('tg-webapp');

    // Apply viewport CSS custom properties
    const applyViewport = () => {
      root.setProperty('--tg-viewport-height', `${tg.viewportHeight}px`);
      root.setProperty('--tg-viewport-stable-height', `${tg.viewportStableHeight}px`);
    };

    // Apply safe area CSS custom properties
    const applySafeArea = () => {
      const sa = tg.safeAreaInset;
      const csa = tg.contentSafeAreaInset;
      if (sa) {
        root.setProperty('--tg-safe-area-top', `${Math.max(sa.top, 0)}px`);
        root.setProperty('--tg-safe-area-bottom', `${Math.max(sa.bottom, 0)}px`);
      }
      if (csa) {
        root.setProperty('--tg-content-safe-top', `${Math.max(csa.top, 0)}px`);
        root.setProperty('--tg-content-safe-bottom', `${Math.max(csa.bottom, 0)}px`);
      }
    };

    applyViewport();
    applySafeArea();

    contextValueRef.current = value;
    setContextValue(value);

    // Subscribe to theme changes
    const handleThemeChanged = () => {
      const newTp = tg.themeParams || {};
      const newValue: TelegramThemeContextValue = {
        isAvailable: true,
        bgColor: newTp.bg_color || contextValueRef.current.bgColor,
        textColor: newTp.text_color || contextValueRef.current.textColor,
        buttonColor: newTp.button_color || contextValueRef.current.buttonColor,
        buttonText: newTp.button_text_color || contextValueRef.current.buttonText,
      };

      // Only update if values actually changed
      if (
        newValue.bgColor !== contextValueRef.current.bgColor ||
        newValue.textColor !== contextValueRef.current.textColor ||
        newValue.buttonColor !== contextValueRef.current.buttonColor ||
        newValue.buttonText !== contextValueRef.current.buttonText
      ) {
        contextValueRef.current = newValue;
        setContextValue(newValue);

        // Update CSS vars
        root.setProperty('--tg-theme-bg-color', newValue.bgColor);
        root.setProperty('--tg-theme-text-color', newValue.textColor);
        root.setProperty('--tg-theme-button-color', newValue.buttonColor);
        root.setProperty('--tg-theme-button-text-color', newValue.buttonText);
      }
    };

    // Subscribe to viewport/safe area changes
    const handleViewportChanged = () => {
      applyViewport();
    };

    const handleSafeAreaChanged = () => {
      applySafeArea();
    };

    tg.onEvent('themeChanged', handleThemeChanged);
    tg.onEvent('viewportChanged', handleViewportChanged);
    tg.onEvent('safeAreaChanged', handleSafeAreaChanged);
    tg.onEvent('contentSafeAreaChanged', handleSafeAreaChanged);

    // Cleanup
    return () => {
      tg.offEvent('themeChanged', handleThemeChanged);
      tg.offEvent('viewportChanged', handleViewportChanged);
      tg.offEvent('safeAreaChanged', handleSafeAreaChanged);
      tg.offEvent('contentSafeAreaChanged', handleSafeAreaChanged);
    };
  }, []);

  return (
    <TelegramThemeContext.Provider value={contextValue}>
      {children}
    </TelegramThemeContext.Provider>
  );
}