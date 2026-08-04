/**
 * F-04 Voice Recorder hook (F04-02).
 *
 * Records audio via MediaRecorder, picks MIME type per platform (iOS TWA → mp4),
 * and uploads to /api/ai/transcribe for Groq Whisper STT.
 *
 * Based on: onitask_ai_.md §3.1–§3.2
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { pickAudioMimeType } from '../lib/ai/stt';

type RecorderState = 'idle' | 'recording' | 'processing' | 'error';

interface UseVoiceRecorderOptions {
  initData: string;
  onTranscribed: (text: string) => void;
}

/** Timeout for the transcribe request — prevents infinite "processing" state */
const TRANSCRIBE_TIMEOUT_MS = 15000;

export function useVoiceRecorder({ initData, onTranscribed }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        setState('processing');

        // Abort controller + timeout — prevents infinite "processing" state
        const controller = new AbortController();
        abortControllerRef.current = controller;
        timeoutRef.current = setTimeout(() => {
          console.warn('[useVoiceRecorder] Transcribe request timed out after', TRANSCRIBE_TIMEOUT_MS, 'ms');
          controller.abort();
        }, TRANSCRIBE_TIMEOUT_MS);

        try {
          const formData = new FormData();
          formData.append('init_data', initData);
          // Расширение должно соответствовать реальному формату (iOS → mp4, десктоп → webm)
          const mimeType = blob.type || 'audio/webm';
          const ext = mimeType.split('/')[1]?.split(';')[0] || 'webm';
          formData.append('audio', blob, `audio.${ext}`);

          console.log('[useVoiceRecorder] Uploading audio blob:', blob.size, 'bytes, type:', blob.type);
          const res = await fetch('/api/ai/transcribe', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });
          console.log('[useVoiceRecorder] Response status:', res.status);
          const rawText = await res.text();
          console.log('[useVoiceRecorder] Response body:', rawText);
          const data = JSON.parse(rawText);
          if (!res.ok) throw new Error(data.error || 'Ошибка распознавания');
          console.log('[useVoiceRecorder] Transcribed:', data.text);
          onTranscribed(data.text);
          setState('idle');
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ошибка распознавания';
          console.error('[useVoiceRecorder] Transcribe failed:', err);
          setError(message);
          setState('error');
        } finally {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          abortControllerRef.current = null;
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setState('recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нет доступа к микрофону');
      setState('error');
    }
  }, [initData, onTranscribed]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { state, error, start, stop };
}