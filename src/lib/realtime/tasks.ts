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

type TasksRow = Database['public']['Tables']['tasks']['Row'];

// ─── Realtime Event Types ────────────────────────────────────────────────────

export interface RealtimeTaskEvent {
  /** Event type: INSERT, UPDATE, DELETE */
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Task data (null for DELETE) */
  task: TasksRow | null;
  /** Old task data (for UPDATE/DELETE) */
  oldTask: TasksRow | null;
  /** Commit timestamp */
  commitTimestamp: string;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useTasksRealtime — subscribes to Realtime events on the tasks table
 * for the current user's workspace.
 * 
 * Emits events for INSERT, UPDATE, DELETE operations.
 * Automatically unsubscribes on unmount.
 */
export function useTasksRealtime(
  workspaceId: string | null,
  onEvent: (event: RealtimeTaskEvent) => void,
) {
  const channelRef = useRef<any>(null);
  const callbackRef = useRef(onEvent);

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
          callbackRef.current({
            eventType,
            task: payload.new as TasksRow | null,
            oldTask: payload.old as TasksRow | null,
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