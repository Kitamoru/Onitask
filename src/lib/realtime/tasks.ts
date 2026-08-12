/**
 * Realtime helpers for Flow Board.
 * 
 * Subscribes to Supabase Realtime channel on the tasks table
 * and provides a React hook for consuming events.
 * 
 * Based on: docs/onitask_flow_.md §13 (Realtime subscription), TASKS.md FLOW-04
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getClient } from '../supabase/client';
import type { Database } from '../../../types/supabase';
import type { TaskEntity } from '@/types/flowboard';

type TasksRow = Database['public']['Tables']['tasks']['Row'];

// ─── Realtime Event Types ────────────────────────────────────────────────────

/**
 * Enriched task row with full_id computed from workspace prefix + task_number.
 * This matches the format used by the API and DataContext.
 */
export interface RealtimeTaskEvent {
  /** Event type: INSERT, UPDATE, DELETE */
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Enriched task data with full_id (null for DELETE) */
  task: TaskEntity | null;
  /** Raw old task data (for UPDATE/DELETE) — also enriched if possible */
  oldTask: TaskEntity | null;
  /** Commit timestamp */
  commitTimestamp: string;
}

/**
 * Build full_id from workspace prefix and task_number.
 * Consistent with mapTaskRow() in /api/tasks/[id]/route.ts and DataContext.
 */
export function buildFullId(prefix: string | null | undefined, taskNumber: number | null | undefined, fallbackId: string): string {
  if (prefix && taskNumber) return `${prefix}-${taskNumber}`;
  return fallbackId.slice(0, 8);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useTasksRealtime — subscribes to Realtime events on the tasks table
 * for the current user's workspace.
 *
 * Emits events for INSERT, UPDATE, DELETE operations with full_id enrichment.
 * Automatically unsubscribes on unmount.
 *
 * @param workspaceId - Workspace UUID to subscribe to
 * @param workspacePrefix - Current workspace's task_prefix (e.g. "TASK", "FEAT")
 * @param onEvent - Callback for each Realtime event
 */
export function useTasksRealtime(
  workspaceId: string | null,
  workspacePrefix: string | null | undefined,
  onEvent: (event: RealtimeTaskEvent) => void,
) {
  const channelRef = useRef<any>(null);
  const callbackRef = useRef(onEvent);
  const prefixRef = useRef(workspacePrefix);

  // Keep prefix ref up to date
  useEffect(() => {
    prefixRef.current = workspacePrefix;
  }, [workspacePrefix]);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!workspaceId) return;

    const supabase = getClient();

    // Create channel for tasks table in this workspace
    const channel = supabase
      .channel(`flowboard-tasks-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload: { eventType: string; new: TasksRow | null; old: TasksRow | null; commit_timestamp?: string }) => {
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          const prefix = prefixRef.current ?? 'TASK';

          let taskEntity: TaskEntity | null = null;
          let oldTaskEntity: TaskEntity | null = null;

          if (payload.new) {
            const raw = payload.new as TasksRow;
            const fullId = buildFullId(prefix, raw.task_number, raw.id);
            taskEntity = {
              ...raw,
              full_id: fullId,
              workspace_prefix: prefix,
              ai_hint: null,
              story_points: null,
            } as TaskEntity;
          }

          if (payload.old && eventType !== 'INSERT') {
            const raw = payload.old as TasksRow;
            const fullId = buildFullId(prefix, raw.task_number, raw.id);
            oldTaskEntity = {
              ...raw,
              full_id: fullId,
              workspace_prefix: prefix,
              ai_hint: null,
              story_points: null,
            } as TaskEntity;
          }

          callbackRef.current({
            eventType,
            task: taskEntity,
            oldTask: oldTaskEntity,
            commitTimestamp: (payload as any).commit_timestamp || new Date().toISOString(),
          });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [workspaceId]);
}

/**
 * useFlowMetricsRealtime — subscribes to flow metrics cache invalidation events.
 * 
 * When tasks change, the flow metrics cache may need invalidation.
 * This hook listens for broadcast events that signal cache updates.
 */
export function useFlowMetricsRealtime(
  workspaceId: string | null,
  onInvalidate: () => void,
) {
  const channelRef = useRef<any>(null);
  const invalidateRef = useRef(onInvalidate);

  useEffect(() => {
    invalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!workspaceId) return;

    const supabase = getClient();

    const channel = supabase
      .channel(`flowboard-metrics-${workspaceId}`)
      .on(
        'broadcast',
        { event: 'task_changed' },
        ({ payload }: { payload: { workspace_id?: string } }) => {
          if (payload.workspace_id === workspaceId) {
            invalidateRef.current();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [workspaceId]);
}