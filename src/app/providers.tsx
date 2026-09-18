'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { markPerf } from '@/lib/perf/timings';

// PERF-06: t0 — начало исполнения клиентского бандла. Точка отсчёта для замера
// boot-фаз (см. src/lib/perf/timings.ts). Без флага ?perf=1 — no-op.
markPerf('t0');

/**
 * React Query provider (attachments, comments, future server-state).
 *
 * TWA-специфика:
 * - refetchOnWindowFocus: false — focus-события в Telegram webview ненадёжны;
 * - retry: 1 — не штормим API при 401 (например, после истечения initData 24ч);
 * - staleTime/gcTime для attachments переопределяются точечно на query.
 */
export function QueryProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 30 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
