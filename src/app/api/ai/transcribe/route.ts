'use server';

/**
 * F-04 AI — Transcribe endpoint (F04-01).
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const initData = formData.get('init_data') as string | undefined;
    const audio = formData.get('audio') as File | null;

    const auth = await authenticateRequest(initData);
    if (!auth.authenticated) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
    }

    if (!audio) {
      return NextResponse.json({ error: 'Файл audio обязателен' }, { status: 400 });
    }

    const blob = new Blob([await audio.arrayBuffer()], { type: audio.type || 'audio/webm' });
    console.log('[transcribe] Audio received:', blob.size, 'bytes, type:', blob.type);
    const result = await transcribeAudio(blob);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[transcribe] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ошибка распознавания' },
      { status: 500 },
    );
  }
}
