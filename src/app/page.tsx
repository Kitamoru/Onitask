'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { getPreferredView } from '@/lib/viewPreference';
import { markPerf } from '@/lib/perf/timings';
import { needsBoardCreation } from '@/lib/onboarding';
import { OrbitLoader } from '@/components/shared/OrbitLoader';

// Сброс скролла при переходе на страницу
function useScrollReset() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
}

// Единый отступ сверху для всех страниц
const PAGE_TOP_PADDING = 'max(64px, var(--tg-content-safe-top, 0px))';

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
  useScrollReset();
  const router = useRouter();
  const { isLoading, error, data } = useTelegramAuth();
  const launchContext = data?.launch_context;
  const launchError = data?.launch_error;

  // Онбординг — по состоянию: нет ни одной доски. Обратимо, в отличие от
  // is_new_user (см. src/lib/onboarding.ts).
  // Защита от редиректа на создание доски при ошибке авторизации живёт в
  // самой needsBoardCreation (data === null → false).
  const needsOnboarding = needsBoardCreation(data);

  // Guard: once redirected, NEVER redirect again.
  // Fixes board creation issue where refresh() right after workspace creation
  // re-runs this effect and would bounce the user back to /board/create.
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (hasNavigatedRef.current) return;

    if (launchError) return;

    // Онбординг определяется СОСТОЯНИЕМ (нет досок), а не флагом is_new_user.
    // is_new_user истинно только в том запросе, где профиль был создан, —
    // поэтому прерванный онбординг раньше был необратим. needsOnboarding
    // делает его повторяемым: не создал доску — увидишь форму снова.
    if (needsOnboarding) {
      hasNavigatedRef.current = true;
      markPerf('route:flowboard'); // PERF-06: конец boot-фазы корневого экрана
      router.replace('/board/create');
    } else {
      hasNavigatedRef.current = true;
      markPerf('route:flowboard'); // PERF-06: конец boot-фазы корневого экрана
      const preferred = getPreferredView();
      const preferredTarget = preferred === 'stream' ? '/flowboard?view=stream' : '/flowboard';
      const launch = launchContext;
      // SUB-01: subtask_id едет тем же открытием — карточка родителя плюс
      // подсветка подзадачи внутри (task_id здесь уже id родителя).
      const target = launch?.kind === 'task'
        ? `/flowboard?open_task_id=${encodeURIComponent(launch.task_id)}${launch.subtask_id ? `&subtask_id=${encodeURIComponent(launch.subtask_id)}` : ''}${launch.tab === 'comments' ? '&tab=comments' : ''}`
        : launch?.kind === 'flow'
          ? `/flowboard?workspace_id=${encodeURIComponent(launch.workspace_id)}`
          : preferredTarget;
      router.replace(target);
    }
    // If error or no data, stay on this page and show error below
  }, [isLoading, data, needsOnboarding, launchContext, launchError, router]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-tg-screen"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <OrbitLoader />
      </div>
    );
  }

  if (launchError) {
    return (
      <div className="flex items-center justify-center h-tg-screen p-4" style={{ backgroundColor: '#0A0A0A' }}>
        <p className="text-center max-w-sm text-base text-text">Задача не найдена или нет доступа</p>
      </div>
    );
  }

  // Error state
  if (error) {
    const isNotInTWA = error === 'not_in_twa';
    const isSdkUnavailable = error === 'sdk_unavailable';
    const is401 = error.startsWith('401:');
    const is500 = error.startsWith('500:');

    let message: string;
    if (isNotInTWA) {
      message = 'Откройте приложение через Telegram Web App';
    } else if (isSdkUnavailable) {
      message = 'Telegram не успел загрузиться. Проверьте интернет и попробуйте ещё раз.';
    } else if (is401) {
      message = 'Сессия истекла. Откройте приложение заново через Telegram.';
    } else if (is500) {
      message = 'Сервер временно недоступен. Попробуйте позже.';
    } else {
      message = 'Ошибка инициализации. Попробуйте перезагрузить.';
    }

    return (
      <div
        className="flex items-center justify-center h-tg-screen p-4"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center max-w-sm">
          <p
            style={{
              color: '#EF4444',
              fontFamily: "var(--font-family-display, system-ui, sans-serif)",
              fontSize: '16px',
              lineHeight: '24px',
              fontWeight: '500',
              marginBottom: '16px',
            }}
          >
            {message}
          </p>
          {!isNotInTWA && (
            <button
              onClick={() => window.location.reload()}
              style={{
                fontFamily: "var(--font-family-base, system-ui, sans-serif)",
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
      <OrbitLoader />
    </div>
  );
}