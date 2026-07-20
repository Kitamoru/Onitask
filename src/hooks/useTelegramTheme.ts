'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * useTelegramTheme — Manages Telegram Web App theme integration.
 *
 * Features:
 * 1. Reads initial theme values from Telegram.WebApp at runtime
 * 2. Subscribes to themeChanged event for live updates
 * 3. Applies CSS custom properties to document.documentElement
 * 4. Provides a stable theme state object for React components
 * 5. Gracefully degrades when not in TWA (uses fallback design tokens)
 *
 * Usage:
 *   const theme = useTelegramTheme();
 *   // theme.isAvailable — whether we're running inside Telegram
 *   // theme.bgColor — current background color
 *   // theme.textColors — current text colors
 *   // etc.
 */

interface TelegramThemeVars {
  bgColor: string;
  textColor: string;
  hintColor: string;
  linkColor: string;
  buttonColor: string;
  buttonText: string;
  secondaryBgColor: string;
  sectionBgColor: string;
  sectionHeaderTextColor: string;
  subtitleTextColor: string;
  destructiveTextColor: string;
}

// Default fallback values (dark theme matching our design system)
const DEFAULT_THEME: TelegramThemeVars = {
  bgColor: '#0A0A0A',
  textColor: '#FAFAFA',
  hintColor: '#8B8B8B',
  linkColor: '#F59E0B',
  buttonColor: '#F59E0B',
  buttonText: '#FFFFFF',
  secondaryBgColor: '#1A1A1A',
  sectionBgColor: '#1A1A1A',
  sectionHeaderTextColor: '#808080',
  subtitleTextColor: '#8B8B8B',
  destructiveTextColor: '#EF4444',
};

// Deep equality check for theme objects
function themesEqual(a: TelegramThemeVars, b: TelegramThemeVars): boolean {
  return (
    a.bgColor === b.bgColor &&
    a.textColor === b.textColor &&
    a.hintColor === b.hintColor &&
    a.linkColor === b.linkColor &&
    a.buttonColor === b.buttonColor &&
    a.buttonText === b.buttonText &&
    a.secondaryBgColor === b.secondaryBgColor &&
    a.sectionBgColor === b.sectionBgColor &&
    a.sectionHeaderTextColor === b.sectionHeaderTextColor &&
    a.subtitleTextColor === b.subtitleTextColor &&
    a.destructiveTextColor === b.destructiveTextColor
  );
}

export function useTelegramTheme(): {
  /** Whether Telegram WebApp environment is available */
  isAvailable: boolean;
  /** Current theme CSS variables as a plain object */
  theme: TelegramThemeVars;
  /** Apply theme vars to document.documentElement for CSS variable consumption */
  applyTheme: () => void;
} {
  const [isAvailable, setIsAvailable] = useState(false);
  const [theme, setTheme] = useState<TelegramThemeVars>(DEFAULT_THEME);
  const initRanRef = useRef(false);
  const themeRef = useRef<TelegramThemeVars>(DEFAULT_THEME);

  /**
   * Extracts theme values from Telegram.WebApp.themeParams.
   * Maps Telegram's hex color keys to our semantic variable names.
   */
  const readThemeFromTelegram = useCallback((): TelegramThemeVars => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.themeParams) return DEFAULT_THEME;

    const tp = tg.themeParams;

    return {
      bgColor: tp.bg_color || DEFAULT_THEME.bgColor,
      textColor: tp.text_color || DEFAULT_THEME.textColor,
      hintColor: tp.hint_color || DEFAULT_THEME.hintColor,
      linkColor: tp.link_color || DEFAULT_THEME.linkColor,
      buttonColor: tp.button_color || DEFAULT_THEME.buttonColor,
      buttonText: tp.button_text_color || DEFAULT_THEME.buttonText,
      secondaryBgColor: tp.secondary_bg_color || DEFAULT_THEME.secondaryBgColor,
      sectionBgColor: tp.section_bg_color || DEFAULT_THEME.sectionBgColor,
      sectionHeaderTextColor: tp.section_header_text_color || DEFAULT_THEME.sectionHeaderTextColor,
      subtitleTextColor: tp.subtitle_text_color || DEFAULT_THEME.subtitleTextColor,
      destructiveTextColor: tp.destructive_text_color || DEFAULT_THEME.destructiveTextColor,
    };
  }, []);

  /**
   * Applies theme CSS custom properties to document.documentElement.
   * This allows Tailwind classes like `bg-primary-dark` to reactively update.
   */
  const applyThemeToDom = useCallback((t: TelegramThemeVars) => {
    const root = document.documentElement;
    root.style.setProperty('--tg-theme-bg-color', t.bgColor);
    root.style.setProperty('--tg-theme-text-color', t.textColor);
    root.style.setProperty('--tg-theme-hint-color', t.hintColor);
    root.style.setProperty('--tg-theme-link-color', t.linkColor);
    root.style.setProperty('--tg-theme-button-color', t.buttonColor);
    root.style.setProperty('--tg-theme-button-text-color', t.buttonText);
    root.style.setProperty('--tg-theme-secondary-bg-color', t.secondaryBgColor);
    root.style.setProperty('--tg-theme-section-bg-color', t.sectionBgColor);
    root.style.setProperty('--tg-theme-section-header-text-color', t.sectionHeaderTextColor);
    root.style.setProperty('--tg-theme-subtitle-text-color', t.subtitleTextColor);
    root.style.setProperty('--tg-theme-destructive-text-color', t.destructiveTextColor);
  }, []);

  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;

    const tg = (window as any).Telegram?.WebApp;
    if (!tg) {
      setIsAvailable(false);
      return;
    }

    // Mark as available
    setIsAvailable(true);
    tg.expand?.();

    // Read initial theme (only set if different)
    const initialTheme = readThemeFromTelegram();
    if (!themesEqual(initialTheme, themeRef.current)) {
      themeRef.current = initialTheme;
      setTheme(initialTheme);
    }
    applyThemeToDom(initialTheme);

    // Subscribe to themeChanged event for live updates
    const handleThemeChanged = () => {
      const newTheme = readThemeFromTelegram();
      if (!themesEqual(newTheme, themeRef.current)) {
        themeRef.current = newTheme;
        setTheme(newTheme);
      }
      applyThemeToDom(newTheme);
    };

    tg.onEvent('themeChanged', handleThemeChanged);

    // Handle viewport changes (keyboard open/close)
    const handleViewportChanged = () => {
      console.log('[TelegramTheme] viewportChanged:', {
        viewportHeight: tg.viewportHeight,
        viewportStableHeight: tg.viewportStableHeight,
      });
    };

    tg.onEvent('viewportChanged', handleViewportChanged);

    // Cleanup on unmount
    return () => {
      tg.offEvent('themeChanged', handleThemeChanged);
      tg.offEvent('viewportChanged', handleViewportChanged);
    };
  }, [readThemeFromTelegram, applyThemeToDom]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isAvailable,
    theme,
    applyTheme: () => applyThemeToDom(theme),
  };
}