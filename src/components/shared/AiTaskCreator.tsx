'use client';

/**
 * AiTaskCreator — Global task creation entry point.
 *
 * Renders the BottomMenu with a center button that opens the F-04 AI task
 * creation overlay (TaskCreatorSheet) on every page.
 *
 * Flow:
 *   Center button → TaskCreatorSheet (text/voice input + waveform) →
 *   /api/ai/create-task (полный Route Handler §3.6: parse + INSERT tasks +
 *   enrichment_queue/task_enrichments + task_events) → условный CorrectionSheet (§3.7)
 *   → refresh FlowBoard data.
 *
 * Based on: onitask_ai_.md §3.1–§3.7, TASKS.md Stage 5 F-04
 * INV-05: workspace_id is resolved server-side (workers.source_id = profileId)
 */

import React, { useState, useCallback } from 'react';
import { BottomMenu } from './BottomMenu';
import { TaskCreatorSheet } from '@/components/ai/TaskCreatorSheet';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';

export function AiTaskCreator() {
  const { initData } = useTelegramAuth();
  const { loadBoardsData, state } = useData();
  const [open, setOpen] = useState(false);

  const handleCenterClick = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleTaskCreated = useCallback(
    async (_taskId: string) => {
      // Задача уже создана на сервере (/api/ai/create-task) со всеми полями.
      // Здесь только закрываем оверлей и обновляем данные.
      setOpen(false);
      try {
        await loadBoardsData(state.activeWorkspaceId ?? undefined, { partial: true });
      } catch (err) {
        console.error('[AiTaskCreator] Failed to refresh after task creation:', err);
      }
    },
    [loadBoardsData, state.activeWorkspaceId],
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
      />
    </>
  );
}