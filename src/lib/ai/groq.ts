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
  const groq = getGroqClient();

  const file = new File([audioBlob], 'audio.webm', { type: audioBlob.type || 'audio/webm' });

  const response = await groq.audio.transcriptions.create({
    model: 'whisper-large-v3-turbo',
    file,
  });

  return { text: response.text };
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