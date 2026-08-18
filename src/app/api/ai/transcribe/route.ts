/**
 * F-04 AI — Transcribe endpoint (F04-01).
 * Route handlers are server-side by default in Next.js App Router — no 'use server' directive.
 *
 * POST /api/ai/transcribe
 * FormData: { init_data, audio }
 *
 * Flow:
 *   1. Auth (initData)
 *   2. Read audio file from FormData
 *   3. Call Groq Whisper (whisper-large-v3-turbo)
 *   4. Return transcribed text
 *
 * Based on: onitask_ai_.md §3.2
 * Security: onitask_security_.md §1.1
 * A-1: Vercel Hot Path (< 2s)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../../../lib/api-auth';
import { transcribeAudio } from '../../../../lib/ai/groq';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Groq Whisper может обрабатывать аудио дольше 10с (Vercel Hobby limit)
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const initData = formData.get('init_data') as string | undefined;
    const audio = formData.get('audio') as File | null;

    // Server-to-server auth: bot calls this endpoint with service_token
    let auth = await authenticateRequest(initData);
    if (!auth.authenticated && !initData) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearer = authHeader.replace(/^Bearer\s+/i, '');
      if (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY) {
        auth = { authenticated: true };
      }
    }

    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    if (!audio) {
      return NextResponse.json({ error: 'Файл audio обязателен' }, { status: 400 });
    }

    // Telegram voice всегда в OGG/Opus — не меняем MIME type
    const mimeType = audio.type || 'audio/ogg';
    const blob = new Blob([await audio.arrayBuffer()], { type: mimeType });
    console.log('[transcribe] Audio received:', blob.size, 'bytes, type:', blob.type);
    const result = await transcribeAudio(blob);
    console.log('[transcribe] transcribeAudio returned, result:', JSON.stringify(result));

    return NextResponse.json(result);
  } catch (err) {
    console.error('[transcribe] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка распознавания' },
      { status: 500 },
    );
  }
}
