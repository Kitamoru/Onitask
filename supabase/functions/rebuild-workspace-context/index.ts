/**
 * Supabase Edge Function: rebuild_workspace_context
 *
 * F-04-11 / ai_.md §2.9 — Rebuild Pipeline для workspace_context_cache.
 *
 * Собирает 5 источников оперативного состояния воркспейса и формирует
 * сжатый JSON-снапшот (≤500 символов) через NeuralDeep GPT-OSS-120B.
 *
 * Триггеры инвалидации (Master §6.16):
 *   - needs_human → true (эскалация)
 *   - handoff_to заполнен
 *   - priority → 'critical'
 *   - sprints.status → 'active'
 *   - sprints.status → 'completed'
 *
 * INV-14: система никогда не пишет в workspace_context напрямую.
 * INV-05: все AI-outputs содержат workspace_id.
 * A-12: Relational Context Layer — кеш используется потребителями (F-03, F-04, MCP).
 *
 * Behavior:
 *   - Fetches pending rebuild jobs from enrichment_queue (type='workspace_context_rebuild')
 *   - Collects 5 sources: active sprint, top-20 tasks, workers load, escalation count, blocker count
 *   - Single LLM call (NeuralDeep, ≤200 tokens) → UPDATE workspace_settings
 *   - Sets context_stale = false after successful update
 */

// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface RebuildJob {
  id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
}

interface SprintRow {
  id: string;
  title: string;
  status: string;
  goal: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  priority: string;
  column: string;
  assigned_to: string | null;
  deadline_urgency: string | null;
  is_inbox: boolean;
}

interface WorkerRow {
  id: string;
  display_name: string;
  task_count: number;
  overloaded: boolean;
}

interface EscalationCount {
  count: number;
}

interface BlockerCount {
  count: number;
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const NEURALDEEP_URL = 'https://api.neuraldeep.ru/v1';
const MODEL = 'gpt-oss-120b';
const MAX_CACHE_LENGTH = 500;

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Call NeuralDeep GPT-OSS-120B to generate a compressed cache snapshot.
 * Returns a string ≤ MAX_CACHE_LENGTH characters.
 */
async function generateCacheSnapshot(
  context: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(`${NEURALDEEP_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `Ты — ассистент формирования оперативного контекста для таск-трекера onitask.
Твоя задача: сжать предоставленные данные в краткий JSON-снапшот (максимум ${MAX_CACHE_LENGTH} символов).
Формат ответа: {"sprint": "название|статус", "top_tasks": ["задача1", "задача2"], "overloaded_workers": ["имя1"], "escalations": N, "blockers": N}.
Отвечай ТОЛЬКО JSON без markdown-обёртки.`,
        },
        { role: 'user', content: context },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`NeuralDeep failed: ${res.status} ${error}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('NeuralDeep returned empty content');

  // Clean up potential markdown wrapping
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return cleaned.slice(0, MAX_CACHE_LENGTH);
}

// ═══════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════

serve(async (req: Request) => {
  try {
    // ── 1. Initialize Supabase client (service role) ────────
    const supabaseUrl = Deno.env.get('SB_URL') || '';
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
    const neuralDeepKey = Deno.env.get('NEURALDEEP_KEY') || '';

    if (!neuralDeepKey) {
      return new Response(
        JSON.stringify({ error: 'NEURALDEEP_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 2. Fetch pending rebuild job ────────────────────────
    const { data: job, error: jobError } = await supabase
      .from('enrichment_queue')
      .select('*')
      .eq('type', 'workspace_context_rebuild')
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle() as { data: RebuildJob | null; error: unknown };

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ message: 'No pending rebuild jobs' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Lock the job
    await supabase
      .from('enrichment_queue')
      .update({ status: 'processing', locked_at: new Date().toISOString() })
      .eq('id', job.id);

    const workspaceId = job.workspace_id;

    // ── 3. Source 1: Active sprint ──────────────────────────
    const { data: sprint } = await supabase
      .from('sprints')
      .select('id, title, status, goal')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .maybeSingle();

    // ── 4. Source 2: Top-20 active tasks (by priority + urgency) ──
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, priority, column, assigned_to, deadline_urgency, is_inbox')
      .eq('workspace_id', workspaceId)
      .eq('is_inbox', false)
      .in('column', ['in_progress', 'review', 'backlog'])
      .order('priority', { ascending: false })
      .limit(20);

    // ── 5. Source 3: Workers + Cognitive load (A-9 formula) ──
    // v0.11.0: нагрузка по формуле A-9 — SUM(cognitive_weight) по
    // in_progress(assigned) + review(reviewer), is_inbox исключены.
    // Ранее считался простой count задач — без веса это не отражало
    // когнитивную нагрузку (расхождение с view overloaded_workers, sql_anomalies_.md §3.2).
    const [workersRes, loadRes] = await Promise.all([
      supabase
        .from('workers')
        .select('id, display_name, type')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true),
      supabase
        .from('tasks')
        .select('assigned_to, reviewer_id, cognitive_weight, column')
        .eq('workspace_id', workspaceId)
        .in('column', ['in_progress', 'review'])
        .eq('is_inbox', false),
    ]);

    // Агрегация нагрузки по формуле A-9
    // - in_progress: assigned_to += cognitive_weight
    // - review: reviewer_id += cognitive_weight
    const loadByWorker = new Map<string, number>();
    for (const t of loadRes.data ?? []) {
      const weight = t.cognitive_weight ?? 1;
      if (t.column === 'in_progress' && t.assigned_to) {
        loadByWorker.set(t.assigned_to, (loadByWorker.get(t.assigned_to) ?? 0) + weight);
      }
      if (t.column === 'review' && t.reviewer_id) {
        loadByWorker.set(t.reviewer_id, (loadByWorker.get(t.reviewer_id) ?? 0) + weight);
      }
    }

    const workersWithLoad = (workersRes.data ?? []).map((w: any) => ({
      display_name:    w.display_name,
      type:             w.type,
      cognitive_load:   Math.min(3, loadByWorker.get(w.id) ?? 0), // шкала F-01: 0–3
    }));

    // Identify overloaded workers for LLM context (≥3 cognitive load)
    const overloadedWorkers = workersWithLoad
      .filter((w: any) => w.cognitive_load >= 3)
      .map((w: any) => w.display_name);

    // ── 6. Source 4: Escalation count (last 24h) ───────────
    let escalationCount = 0;
    try {
      const { data: escResult } = await supabase.rpc('get_escalation_count', {
        p_workspace_id: workspaceId,
      }) as { data: EscalationCount | null; error: unknown };
      escalationCount = escResult?.count ?? 0;
    } catch (err) {
      console.error('rebuild-workspace-context: escalation count RPC failed (fallback 0)', err);
    }

    // ── 7. Source 5: Blocker count (orphan_blockers view) ──
    let blockerCount = 0;
    try {
      const { data: blkResult } = await supabase.rpc('get_blocker_count', {
        p_workspace_id: workspaceId,
      }) as { data: BlockerCount | null; error: unknown };
      blockerCount = blkResult?.count ?? 0;
    } catch (err) {
      console.error('rebuild-workspace-context: blocker count RPC failed (fallback 0)', err);
    }

    // ── 8. Build context string for LLM ─────────────────────
    const sprintInfo = sprint
      ? `Спринт: "${sprint.title}" (${sprint.status}), цель: ${sprint.goal ?? 'не указана'}`
      : 'Нет активного спринта';

    const topTasksList = (tasks ?? [])
      .slice(0, 5)
      .map((t) => `${t.title} [${t.priority}, ${t.column}]`)
      .join('; ') || 'Нет задач';

    // Workers with cognitive load (v0.11.0) — передаём в LLM
    const workersDetail = workersWithLoad.length > 0
      ? workersWithLoad.map((w: any) =>
          `${w.display_name} (${w.type ?? 'human'}, нагрузка ${w.cognitive_load}/3)`
        ).join('; ')
      : 'нет данных';

    const overloadedList = overloadedWorkers.length > 0
      ? overloadedWorkers.join(', ')
      : 'нет';

    const contextForLLM = `ДАННЫЕ ДЛЯ ОПЕРАТИВНОГО КОНТЕКСТА WORKSPACE:\n\n` +
      `1. СПРИНТ: ${sprintInfo}\n\n` +
      `2. ТОП-ЗАДАЧИ (по приоритету):\n${topTasksList}\n\n` +
      `3. УЧАСТНИКИ И ИХ НАГРУЗКА:\n${workersDetail}\n\n` +
      `4. ПЕРЕГРУЖЕННЫЕ (нагрузка ≥3): ${overloadedList}\n\n` +
      `5. ЭСКАЛАЦИИ (последние 24ч): ${escalationCount}\n\n` +
      `6. БЛОКИРОВКИ: ${blockerCount}\n\n` +
      `Сожми эти данные в JSON-снапшот формата:\n` +
      `{"sprint": "название|статус", "top_tasks": ["задача1", "задача2"], "overloaded_workers": ["имя1"], "escalations": N, "blockers": N}\n` +
      `Максимум ${MAX_CACHE_LENGTH} символов.`;

    // ── 9. Generate cache snapshot via LLM ──────────────────
    let cacheSnapshot: string;
    try {
      cacheSnapshot = await generateCacheSnapshot(contextForLLM, neuralDeepKey);
    } catch (err) {
      console.error('rebuild-workspace-context: LLM call failed', err);
      await supabase
        .from('enrichment_queue')
        .update({ status: 'failed', processed_at: new Date().toISOString() })
        .eq('id', job.id);
      return new Response(
        JSON.stringify({ error: 'llm_call_failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── 10. Update workspace_settings ───────────────────────
    await supabase
      .from('workspace_settings')
      .update({
        workspace_context_cache: cacheSnapshot,
        context_stale: false,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    // ── 11. Mark job done ───────────────────────────────────
    await supabase
      .from('enrichment_queue')
      .update({ status: 'done', processed_at: new Date().toISOString() })
      .eq('id', job.id);

    return new Response(
      JSON.stringify({
        message: 'Workspace context cache rebuilt successfully',
        workspace_id: workspaceId,
        cache_length: cacheSnapshot.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('rebuild-workspace-context: unexpected error', err);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});