'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

/**
 * Root page — Telegram Web App entry point.
 *
 * Flow:
 * 1. Call POST /api/init with Telegram initData + start_param
 * 2. If is_new_user === true → redirect to /board/create (workspace creation)
 * 3. If is_new_user === false → redirect to /flowboard (main app)
 * 4. Show loading screen while initializing
 * 5. Show error screen if initialization fails
 */

export default function HomePage() {
  const router = useRouter();
  const { isLoading, error, data } = useAuth();

  // Guard against repeated redirects. Once we've redirected, never redirect again.
  // This prevents race conditions when auth data refreshes (e.g., after workspace creation).
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    // Once navigated away from root, NEVER come back or re-redirect
    if (hasNavigatedRef.current) return;

    // Only redirect on initial mount/resolution, not on subsequent data changes
    // This fixes the board creation issue where refresh() flips is_new_user to false
    if (data?.is_new_user === true) {
      hasNavigatedRef.current = true;
      router.replace('/board/create');
    } else if (data?.is_new_user === false) {
      hasNavigatedRef.current = true;
      router.replace('/flowboard');
    }
    // If error or no data, stay on this page and show error below
  }, [isLoading, data?.is_new_user, router]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-tg-screen"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center">
          <p
            style={{
              color: '#FAFAFA',
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '16px',
              lineHeight: '24px',
            }}
          >
            Загрузка...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    const isNotInTWA = error === 'not_in_twa';

    return (
      <div
        className="flex items-center justify-center h-tg-screen p-4"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center max-w-sm">
          <p
            style={{
              color: '#EF4444',
              fontFamily: "'Inter Display', system-ui, sans-serif",
              fontSize: '16px',
              lineHeight: '24px',
              fontWeight: '500',
              marginBottom: '16px',
            }}
          >
            {isNotInTWA
              ? 'Откройте приложение через Telegram Web App'
              : 'Ошибка инициализации. Попробуйте перезагрузить.'}
          </p>
          {!isNotInTWA && (
            <button
              onClick={() => window.location.reload()}
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontSize: '14px',
                padding: '8px 16px',
                borderRadius: '8px',
                backgroundColor: '#F59E0B',
                color: '#0A0A0A',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '600',
              }}
            >
              Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  // Fallback (should not happen, but just in case)
  return (
    <div
      className="flex items-center justify-center h-tg-screen"
      style={{ backgroundColor: '#0A0A0A' }}
    >
      <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
    </div>
  );
}