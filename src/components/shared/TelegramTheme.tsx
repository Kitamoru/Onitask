'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * TelegramThemeProvider — Context provider for Telegram WebApp theme integration.
 *
 * This component:
 * 1. Reads Telegram.WebApp at mount time
 * 2. Applies theme CSS variables to document.documentElement
 * 3. Adds 'tg-webapp' class to <html> when running inside Telegram
 * 4. Subscribes to themeChanged and viewportChanged events
 * 5. Provides theme state via React context for components that need it
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

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    // Read initial theme params
    const tp = tg.themeParams || {};
    const value: TelegramThemeContextValue = {
      isAvailable: true,
      bgColor: tp.bg_color || DEFAULT_CONTEXT.bgColor,
      textColor: tp.text_color || DEFAULT_CONTEXT.textColor,
      buttonColor: tp.button_color || DEFAULT_CONTEXT.buttonColor,
      buttonText: tp.button_text_color || DEFAULT_CONTEXT.buttonText,
    };

    // Apply CSS custom properties to document.documentElement
    const root = document.documentElement;
    root.style.setProperty('--tg-theme-bg-color', value.bgColor);
    root.style.setProperty('--tg-theme-text-color', value.textColor);
    root.style.setProperty('--tg-theme-button-color', value.buttonColor);
    root.style.setProperty('--tg-theme-button-text-color', value.buttonText);

    // Add tg-webapp class to html for CSS targeting
    root.classList.add('tg-webapp');

    setContextValue(value);

    // Subscribe to theme changes
    const handleThemeChanged = () => {
      const newTp = tg.themeParams || {};
      const newValue: TelegramThemeContextValue = {
        ...value,
        bgColor: newTp.bg_color || value.bgColor,
        textColor: newTp.text_color || value.textColor,
        buttonColor: newTp.button_color || value.buttonColor,
        buttonText: newTp.button_text_color || value.buttonText,
      };
      setContextValue(newValue);

      // Update CSS vars
      root.style.setProperty('--tg-theme-bg-color', newValue.bgColor);
      root.style.setProperty('--tg-theme-text-color', newValue.textColor);
      root.style.setProperty('--tg-theme-button-color', newValue.buttonColor);
      root.style.setProperty('--tg-theme-button-text-color', newValue.buttonText);
    };

    tg.onEvent('themeChanged', handleThemeChanged);

    // Cleanup
    return () => {
      tg.offEvent('themeChanged', handleThemeChanged);
    };
  }, []);

  return (
    <TelegramThemeContext.Provider value={contextValue}>
      {children}
    </TelegramThemeContext.Provider>
  );
}