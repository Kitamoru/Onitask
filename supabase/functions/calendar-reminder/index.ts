/**
 * Supabase Edge Function: calendar_reminder
 *
 * Модуль «Календарь» v0.14.0 — обработка отложенных напоминаний.
 *
 * Архитектура:
 * - Читает pending job из enrichment_queue (type='bot_notify', alert_type='calendar_reminder')
 * - Перечитывает calendar_events (чтобы текст был актуальным при гонке)
 * - Резолвит target_worker_id → workers.source_id → profiles.telegram_id
 * - Отправляет sendMessage в личный Telegram-чат
 *
 * Master Spec §6.19, onitask_calendar_.md §5, bot.md §6.5.1
 */

// @ts-nocheck — Supabase Edge Function uses Deno runtime, not Node.js
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════

interface ReminderJob {
  id: string;
  workspace_id: string;
  payload: {
    workspace_id: string;
    alert_type: 'calendar_reminder';
    event_id: string;
    target_worker_id: string;
  };
}

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  reminder_minutes_before: number;
}

interface WorkerProfile {
  telegram_id: bigint;
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const RETRY_DELAYS = [2000, 10000, 30000]; // ms for Telegram 429 backoff

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/**
 * Formats a date to localized time string (HH:MM).
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Calculates duration between two dates in human-readable format.
 */
function formatDuration(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

  if (diffMinutes < 60) {
    return `${diffMinutes} мин`;
  } else if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return mins > 0 ? `${hours}ч ${mins}мин` : `${hours}ч`;
  } else {
    const days = Math.floor(diffMinutes / 1440);
    const hours = Math.floor((diffMinutes % 1440) / 60);
    return hours > 0 ? `${days}д ${hours}ч` : `${days}д`;
  }
}

/**
 * Sends a message via Telegram Bot API with retry/backoff.
 */
async function sendTelegramMessage(
  botToken: string,
  chatId: bigint | number,
  text: string,
  parseMode: 'HTML' = 'HTML'
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: Number(chatId),
            text,
            parse_mode: parseMode,
            reply_markup: JSON.stringify({
              inline_keyboard: [
                [
                  {
                    text: 'Открыть в TWA →',
                    web_app: { url: 'https://t.me/onitask_bot/app' },
                  },
                ],
              ],
            }),
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        return { ok: true, messageId: data.result?.message_id };
      }

      const errorData = await response.json().catch(() => ({}));

      // Handle Telegram 429 (rate limit)
      if (response.status === 429) {
        const retryAfter = errorData.retry_after || RETRY_DELAYS[attempt];
        await sleep(retryAfter);
        continue;
      }

      // Handle 403 (Bot has no access — user never started /start)
      if (response.status === 403) {
        return {
          ok: false,
          error: 'DM_UNAVAILABLE',
        };
      }

      // Other errors — log and fail immediately (no retry)
      return {
        ok: false,
        error: `telegram_api_error_${response.status}: ${JSON.stringify(errorData)}`,
      };
    } catch (fetchErr) {
      if (attempt === RETRY_DELAYS.length - 1) {
        return {
          ok: false,
          error: `network_error: ${fetchErr instanceof Error ? fetchErr.message : 'unknown'}`,
        };
      }
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  return { ok: false, error: 'max_retries_exceeded' };
}

/**
 * Sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the reminder message text from event data.
 */
function buildReminderMessage(event: CalendarEvent): string {
  const startFormatted = formatTime(event.start_at);
  const durationFormatted = formatDuration(event.start_at, event.end_at);

  return `<b>📅 Напоминание: «${escapeHtml(event.title)}»</b>
⏰ Начало: ${startFormatted}
📍 Длительность: ${durationFormatted}`;
}

/**
 * Escapes HTML special characters for safe Telegram HTML formatting.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

// ═══════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════

serve(async (req: Request) => {
  try {
    // ── 1. Initialize Supabase client (service role) ────────
    const supabaseUrl = Deno.env.get('SB_URL') || '';
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase credentials not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!telegramBotToken) {
      return new Response(
        JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 2. Authenticate request ────────────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_KEY') || '';

    if (!(serviceKey && authHeader.startsWith(`Bearer ${serviceKey}`))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── 3. Fetch pending calendar_reminder jobs ────────────
    const { data: jobs, error: jobsError } = await supabase
      .from('enrichment_queue')
      .select('*')
      .eq('type', 'bot_notify')
      .eq('status', 'pending')
      .filter('payload->>alert_type', 'eq', 'calendar_reminder')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(20)
      .is('locked_at', null) as { data: ReminderJob[] | null; error: unknown };

    if (jobsError) {
      console.error('calendar_reminder: job fetch error', jobsError);
      return new Response(
        JSON.stringify({ error: 'job_fetch_failed', details: jobsError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending calendar_reminder jobs' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let processed = 0;
    const errors: string[] = [];

    // ── 4. Process each job ────────────────────────────────
    for (const job of jobs) {
      try {
        // Lock the job
        await supabase
          .from('enrichment_queue')
          .update({ status: 'processing', locked_at: new Date().toISOString() })
          .eq('id', job.id);

        const { event_id, target_worker_id } = job.payload;

        // ── 4a. Re-read calendar_event (race condition protection) ──
        // If event was deleted/changed between scheduling and processing,
        // we use current state — or skip if event no longer exists.
        const { data: event, error: eventError } = await supabase
          .from('calendar_events')
          .select('*')
          .eq('id', event_id)
          .maybeSingle() as { data: CalendarEvent | null; error: unknown };

        if (eventError) {
          throw new Error(`event_fetch_error: ${JSON.stringify(eventError)}`);
        }

        if (!event) {
          // Event was deleted — mark done silently (no reminder needed)
          await supabase
            .from('enrichment_queue')
            .update({ status: 'done', processed_at: new Date().toISOString() })
            .eq('id', job.id);
          processed++;
          continue;
        }

        // Check if reminder is still valid (event hasn't started yet)
        if (new Date(event.start_at) <= new Date()) {
          // Event already started or passed — skip reminder
          await supabase
            .from('enrichment_queue')
            .update({ status: 'done', processed_at: new Date().toISOString() })
            .eq('id', job.id);
          processed++;
          continue;
        }

        // ── 4b. Resolve target_worker_id → telegram_id ────────
        const { data: profile, error: profileError } = await supabase
          .from('workers')
          .select(`
            source_id
          `)
          .eq('id', target_worker_id)
          .eq('is_active', true)
          .maybeSingle() as { data: { source_id: string } | null; error: unknown };

        if (profileError || !profile) {
          throw new Error(`worker_not_found: worker_id=${target_worker_id}`);
        }

        const { data: telegramProfile, error: tgError } = await supabase
          .from('profiles')
          .select('telegram_id')
          .eq('id', profile.source_id)
          .maybeSingle() as { data: WorkerProfile | null; error: unknown };

        if (tgError || !telegramProfile) {
          throw new Error(`profile_not_found: source_id=${profile.source_id}`);
        }

        // ── 4c. Build and send reminder message ───────────────
        const messageText = buildReminderMessage(event);
        const result = await sendTelegramMessage(
          telegramBotToken,
          telegramProfile.telegram_id,
          messageText
        );

        if (!result.ok) {
          if (result.error === 'DM_UNAVAILABLE') {
            // User never started bot — no retry possible
            errors.push(`job_${job.id}: DM unavailable (user never /start)`);
          } else {
            errors.push(`job_${job.id}: ${result.error}`);
          }

          await supabase
            .from('enrichment_queue')
            .update({
              status: 'failed',
              processed_at: new Date().toISOString(),
            })
            .eq('id', job.id);
        } else {
          processed++;
          await supabase
            .from('enrichment_queue')
            .update({
              status: 'done',
              processed_at: new Date().toISOString(),
            })
            .eq('id', job.id);
        }
      } catch (jobErr) {
        console.error(`calendar_reminder: job ${job.id} failed`, jobErr);
        errors.push(`job_${job.id}: ${jobErr instanceof Error ? jobErr.message : 'unknown'}`);

        await supabase
          .from('enrichment_queue')
          .update({
            status: 'failed',
            processed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }
    }

    // ── 5. Return summary ──────────────────────────────────
    const response: Record<string, unknown> = {
      message: 'Calendar reminders processed',
      processed,
      total: jobs.length,
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('calendar_reminder: unexpected error', err);
    return new Response(
      JSON.stringify({
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});