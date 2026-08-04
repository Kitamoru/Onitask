'use client';

/**
 * AiTaskCreator — Global task creation entry point.
 *
 * Renders the BottomMenu with a center button that opens the F-04 AI task
 * creation overlay (AiInput + CorrectionSheet) on every page.
 *
 * Flow:
 *   Center button → AiInput (text/voice) → /api/ai/parse-task → CorrectionSheet
 *   → /api/tasks (create) → refresh FlowBoard data via DataContext.
 *
 * Based on: onitask_ai_.md §3.1–§3.7, TASKS.md Stage 5 F-04
 * INV-05: workspace_id is resolved server-side (workers.source_id = profileId)
 */

import React, { useState, useCallback } from 'react';
import { BottomMenu } from './BottomMenu';
import { AiInput } from '@/components/ai/AiInput';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { useData } from '@/contexts/DataContext';
import { createTask } from '@/lib/api/flow';
import type { ParseResponseV2 } from '@/lib/ai/types';

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
    async (task: ParseResponseV2) => {
      // Create the task via /api/tasks (server resolves workspace_id from initData — INV-05)
      try {
        const result = await createTask({
          title: task.title || task.rewritten_title,
          description: task.rewritten_description || undefined,
          priority: task.priority ?? undefined,
          deadline: task.deadline ?? undefined,
          // No column → is_inbox=true (task lands in inbox for triage)
        });
        if (result.error) {
          console.error('[AiTaskCreator] Task creation failed:', result.error);
        }
      } catch (err) {
        console.error('[AiTaskCreator] Task creation failed:', err);
      }

      setOpen(false);
      // Refresh flow data so the new task appears in metrics/columns immediately
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

      {/* AI task creation overlay — fixed bottom sheet above BottomMenu */}
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Создание задачи через AI"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-md rounded-t-2xl p-4"
            style={{
              backgroundColor: 'var(--color-bg-surface)',
              borderTop: '1px solid var(--color-line)',
              paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-body-lg)',
                  fontWeight: 'var(--font-weight-medium)',
                  color: 'var(--color-text-primary)',
                  margin: 0,
                }}
              >
                Новая задача
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg px-3 py-1 text-sm"
                style={{
                  backgroundColor: 'var(--color-bg-surface-hover)',
                  color: 'var(--color-text-muted)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>
            <AiInput initData={initData} onTaskCreated={handleTaskCreated} />
          </div>
        </div>
      )}
    </>
  );
}