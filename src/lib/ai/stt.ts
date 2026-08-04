/**
 * STT Strategy detection (F-04 §3.1).
 *
 * For MVP: always returns 'groq-whisper' — single codepath, safer, works on all platforms.
 * Web Speech API path can be added later as client-side optimization.
 *
 * Based on: onitask_ai_.md §3.1
 */

export type STTStrategy = 'web-speech' | 'groq-whisper';

/**
 * Detect which STT strategy to use.
 *
 * Contract (ai_.md §3.1):
 * - iOS TWA → 'groq-whisper' (primary)
 * - No SpeechRecognition API → 'groq-whisper'
 * - Desktop/Android with SpeechRecognition → 'web-speech'
 *
 * MVP decision: always 'groq-whisper' for unified codepath.
 * Web Speech API will be added as optimization in a future iteration.
 */
export function detectSTTStrategy(): STTStrategy {
  return 'groq-whisper';
}

/**
 * Get preferred MIME type for MediaRecorder based on platform.
 * iOS TWA requires mp4/aac; other platforms prefer webm/opus.
 */
export function getPreferredAudioMimeTypes(): string[] {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isTWA = typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp;

  if (isIOS && isTWA) {
    return ['audio/mp4', 'audio/aac', 'audio/webm'];
  }

  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
}

/**
 * Pick the first supported MIME type from the preferred list.
 * Falls back to 'audio/webm' if none are supported.
 */
export function pickAudioMimeType(): string {
  const preferred = getPreferredAudioMimeTypes();

  if (typeof MediaRecorder !== 'undefined') {
    for (const type of preferred) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
  }

  return 'audio/webm';
}