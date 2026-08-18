/**
 * Groq client — Hot Path AI calls for F-04.
 *
 * Models:
 *   - whisper-large-v3-turbo (STT)
 *   - llama-3.3-70b-versatile (Parse, JSON mode)
 *
 * Based on: onitask_ai_.md §3.2 (Whisper), §3.4 (Parse with JSON mode)
 * Security: onitask_security_.md §1.1 (JSON mode mandatory)
 * A-1: Vercel Hot Path (< 2s), A-6: single model call, no fallback chain
 */

import Groq from 'groq-sdk';
import type { TranscribeResponse } from './types';

// ─── Groq Client Singleton ────────────────────────────────────────────────────

let client: Groq | null = null;

function getGroqClient(): Groq {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set');
    }
    client = new Groq({ apiKey });
  }
  return client;
}

// ─── Transcribe (Whisper) ─────────────────────────────────────────────────────
// ai_.md §3.2 — Groq Whisper path (primary for iOS TWA, used for all platforms in MVP)

export async function transcribeAudio(audioBlob: Blob): Promise<TranscribeResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  // Telegram voice всегда в OGG/Opus (audio/ogg).
  // iOS TWA записывает в audio/mp4, десктоп — в audio/webm.
  // Groq Whisper определяет формат по расширению файла — важно передать .ogg для Telegram.
  const mimeType = audioBlob.type || 'audio/ogg';
  let ext: string;
  // Проверяем name если это File (не Blob)
  const fileName = (audioBlob as File).name || '';
  if (mimeType === 'audio/ogg' || fileName.endsWith('.ogg')) {
    ext = 'ogg';
  } else {
    ext = mimeType.split('/')[1]?.split(';')[0] || 'webm';
  }
  const file = new File([audioBlob], `audio.${ext}`, { type: mimeType });

  console.log('[groq] Sending to Whisper:', file.name, file.type, file.size, 'bytes');

  try {
    // Прямой fetch к Groq REST API — groq-sdk@0.9.0 зависает на audio transcriptions
    // (см. onitask_ai_.md §3.2 — документация использует именно fetch).
    const form = new FormData();
    form.append('file', file);
    form.append('model', 'whisper-large-v3-turbo');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    console.log('[groq] Whisper HTTP status:', res.status);

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq Whisper error ${res.status}: ${errBody}`);
    }

    const json = await res.json();
    console.log('[groq] Whisper response text length:', json.text?.length);
    return { text: json.text };
  } catch (err) {
    console.error('[groq] transcribeAudio failed:', err);
    throw err;
  }
}

// ─── Chat (llama-3.3-70b-versatile with JSON mode) ────────────────────────────
// ai_.md §3.4, security §1.1 — JSON mode is mandatory (response_format: json_object)

export interface ChatOptions {
  /** System/user prompt content */
  prompt: string;
  /** Temperature (default 0.1 for deterministic parse) */
  temperature?: number;
  /** Max tokens (default 800 for parse response) */
  max_tokens?: number;
}

export async function chatCompletion(options: ChatOptions): Promise<string> {
  const groq = getGroqClient();

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: options.prompt }],
    response_format: { type: 'json_object' }, // ← mandatory (LLM-1, security §1.1)
    temperature: options.temperature ?? 0.1,
    max_tokens: options.max_tokens ?? 800,
  });

  return response.choices[0]?.message?.content ?? '';
}