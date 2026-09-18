'use client';

/**
 * AiTaskCreator — Global task creation entry point.
 *
 * Renders the BottomMenu with a center button that opens the F-04 AI task
 * creation overlay (TaskCreatorSheet) on every page.
 *
 * Flow (two-phase creation — задача рождается только по подтверждению):
 *   Center button → TaskCreatorSheet (text/voice input + waveform) →
 *   /api/ai/parse-task (только распознавание, БЕЗ записей в БД) →
 *   TaskPreviewSheet (review/edit parsed draft) →
 *   [Confirm] /api/ai/create-task { parsed } (INSERT tasks + enrichment_queue/
 *   task_enrichments + task_events) → refresh FlowBoard data.
 *   [Cancel] — просто закрытие: в БД ничего не было, DELETE не нужен.
 *
 * Active workspace is passed from DataContext as default workspace_id.
 *
 * Based on: onitask_ai_.md §3.1–§3.7, TASKS.md Stage 5 F-04
 * INV-05: All AI-outputs contain workspace_id
 */

import React, { useState, useCallback } from 'react';
import { BottomMenu } from './BottomMenu';
import { TaskCreatorSheet } from '@/components/ai/TaskCreatorSheet';
import { useQueryClient } from '@tanstack/react-query';
import { BOARD_COUNTS_QUERY_KEY } from '@/lib/api/boardCounts';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';

export function AiTaskCreator() {
  const { initData } = useTelegramAuth();
  const { loadBoardsData, state } = useData();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const handleCenterClick = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleTaskCreated = useCallback(
    async () => {
      try {
        await loadBoardsData(state.activeWorkspaceId ?? undefined, { partial: true });
        // BOARD-AGG: новая задача меняет счётчик «В очереди» на «Столе»
        void queryClient.invalidateQueries({ queryKey: BOARD_COUNTS_QUERY_KEY });
      } catch (err) {
        console.error('[AiTaskCreator] Failed to refresh after task creation:', err);
      }
    },
    [loadBoardsData, state.activeWorkspaceId, queryClient],
  );

  return (
    <>
      <BottomMenu onCenterClick={handleCenterClick} />

      {/* AI task creation bottom sheet */}
      <TaskCreatorSheet
        initData={initData}
        open={open}
        onClose={handleClose}
        onTaskCreated={handleTaskCreated}
        workspaceId={state.activeWorkspaceId}
      />
    </>
  );
}
