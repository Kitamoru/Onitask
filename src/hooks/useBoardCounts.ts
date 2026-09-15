'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BOARD_COUNTS_QUERY_KEY,
  fetchBoardCounts,
  type BoardCountsData,
} from '@/lib/api/boardCounts';

/**
 * useBoardCounts — BOARD-AGG: серверные агрегаты для /boards через React Query.
 *
 * - staleTime 30s + refetchOnMount (default) → мгновенная отрисовка из кэша,
 *   тихий background refresh при визите;
 * - refetchInterval 60s — страховка на пропущенную invalidation / отвалившийся realtime;
 * - placeholderData: previous → фоновый refresh НЕ показывает скелетон,
 *   старые цифры остаются на экране до прихода свежих.
 */
export function useBoardCounts(enabled: boolean) {
  return useQuery<BoardCountsData>({
    queryKey: BOARD_COUNTS_QUERY_KEY,
    queryFn: async () => {
      const initData =
        typeof window !== 'undefined'
          ? ((window as any).Telegram?.WebApp?.initData as string) || ''
          : '';
      if (!initData) throw new Error('no_init_data');
      return fetchBoardCounts(initData);
    },
    enabled,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}
