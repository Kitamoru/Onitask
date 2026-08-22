'use client';

import React from 'react';
import OnitaskLoader from './OnitaskLoader';

/**
 * GlobalLoader — фиксированный overlay, который блокирует весь контент
 * пока приложение не готово к работе.
 *
 * Используется на уровне root layout для плавной загрузки без миганий.
 * Анимация fade-out через CSS transition.
 * Содержит брендовый OnitaskLoader внутри.
 */

interface GlobalLoaderProps {
  /** Когда true — лоадер скрывается с анимацией */
  ready: boolean;
}

export function GlobalLoader({ ready }: GlobalLoaderProps) {
  const [visible, setVisible] = React.useState(true);
  const [animatingOut, setAnimatingOut] = React.useState(false);

  React.useEffect(() => {
    if (ready) {
      // Запускаем анимацию fade-out
      setAnimatingOut(true);
      // После завершения анимации убираем из DOM
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    } else {
      // Если снова не готов — показываем лоадер
      setVisible(true);
      setAnimatingOut(false);
    }
  }, [ready]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background: 'var(--tg-theme-bg-color, var(--color-bg-primary-dark, #0A0A0A))',
        opacity: animatingOut ? 0 : 1,
        transition: 'opacity 0.3s ease-out',
        pointerEvents: animatingOut ? 'none' : 'auto',
      }}
      aria-live="polite"
      aria-busy={!ready}
    >
      <OnitaskLoader />
    </div>
  );
}
