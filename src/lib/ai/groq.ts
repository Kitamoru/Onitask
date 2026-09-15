/**
 * Groq client — Hot Path AI calls for F-04.
 *
 * Models:
 * - whisper-large-v3-turbo (STT) — см. transcribeAudio()
 * - qwen/qwen3.8-27b (Parse, JSON mode, reason=none) — см. chatCompletionQwen()
 *
 * NOTE: llama-3.3-70b-versatile был удалён из поддержки Groq 2025-08-16.
 * Заменён на qwen/qwen3.8-27b с reasoning_effort: none для резервного пути fallback.
 *
 * whisper-large-v3-turbo всё ещё работает — отдельный эндпоинт, не затрагивается.
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
  // Groq Whisper определяет формат по расширению файла — важно передать правильное расширение.
  const mimeType = audioBlob.type || 'audio/ogg';
  const fileName = (audioBlob as File).name || '';

  let ext: string;
  if (
    mimeType === 'audio/ogg' ||
    mimeType === 'audio/opus' ||
    fileName.endsWith('.ogg') ||
    fileName.endsWith('.opus')
  ) {
    ext = 'ogg';
  } else if (mimeType === 'audio/mp4' || mimeType === 'audio/m4a' || fileName.endsWith('.m4a')) {
    ext = 'm4a';
  } else if (mimeType === 'audio/webm' || fileName.endsWith('.webm')) {
    ext = 'webm';
  } else if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3' || fileName.endsWith('.mp3')) {
    ext = 'mp3';
  } else if (mimeType === 'audio/wav' || fileName.endsWith('.wav')) {
    ext = 'wav';
  } else {
    // Неизвестный тип (octet-stream и т.п.) — по умолчанию ogg (Telegram voice)
    ext = 'ogg';
  }

  // Всегда передаём валидный MIME, который понимает Groq
  const safeMime =
    ext === 'ogg'
      ? 'audio/ogg'
      : ext === 'm4a'
        ? 'audio/mp4'
        : ext === 'webm'
          ? 'audio/webm'
          : ext === 'mp3'
            ? 'audio/mpeg'
            : ext === 'wav'
              ? 'audio/wav'
              : 'audio/ogg';

  const file = new File([audioBlob], `audio.${ext}`, { type: safeMime });

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

// ─── Chat (qwen/qwen3.8-27b with reasoning_effort=none, direct fetch) ──────────
// F04-12: резервный путь fallback для create-task, когда NeuralDeep недоступен.
// Прямой fetch (без groq-sdk), т.к. groq-sdk устарел (0.9.0) и не поддерживает
// параметр reasoning_effort в типизированном API.
export interface QwenChatOptions {
  /** System/user prompt content */
  prompt: string;
  /** Temperature (default 0.1 for deterministic parse) */
  temperature?: number;
  /** Max tokens (default 800 for parse response) */
  max_tokens?: number;
}

export async function chatCompletionQwen(options: QwenChatOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          {
            role: 'system',
            content:
              'Respond ONLY with valid JSON. No markdown, no explanations, no code fences.',
          },
          { role: 'user', content: options.prompt },
        ],
        response_format: { type: 'json_object' }, // mandatory (LLM-1, security §1.1)
        temperature: options.temperature ?? 0.1,
        max_tokens: options.max_tokens ?? 800,
        reasoning_effort: 'none', // отключаем режим рассуждений для скорости (hot path)
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Groq Qwen error ${res.status}: ${errBody}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    return content;
  } catch (err) {
    console.error('[groq] chatCompletionQwen failed:', err);
    throw err;
  }
}
