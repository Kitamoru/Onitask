/**
 * F-04 AI Input (F04-05).
 *
 * Text input with voice recording (F04-02) and AI task parsing (F04-03).
 * On submit: calls /api/ai/parse-task, then opens CorrectionSheet (F04-06)
 * for user confirmation before creating the task.
 *
 * Based on: onitask_ai_.md §3.1–§3.6
 */

'use client';

import { useState } from 'react';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { CorrectionSheet } from './CorrectionSheet';
import type { ParseResponseV2 } from '../../lib/ai/types';

interface AiInputProps {
  initData: string;
  onTaskCreated: (task: ParseResponseV2) => void;
}

export function AiInput({ initData, onTaskCreated }: AiInputProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [parse, setParse] = useState<ParseResponseV2 | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { state: recState, start: startRec, stop: stopRec } = useVoiceRecorder({
    initData,
    onTranscribed: (text) => setInput((prev) => (prev ? prev + ' ' : '') + text),
  });

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/parse-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData, input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка AI-парсинга');
      setParse(data.parse);
      setSheetOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка AI-парсинга');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = (edited: ParseResponseV2) => {
    setSheetOpen(false);
    setInput('');
    onTaskCreated(edited);
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white p-2">
        <input
          className="flex-1 bg-transparent p-1 text-sm outline-none"
          placeholder="Опишите задачу голосом или текстом…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          aria-label="Ввод задачи"
        />
        <button
          className="rounded-lg bg-gray-100 p-2 text-sm"
          onClick={recState === 'recording' ? stopRec : startRec}
          aria-label={recState === 'recording' ? 'Остановить запись' : 'Записать голос'}
        >
          {recState === 'recording' ? '⏹' : '🎤'}
        </button>
        <button
          className="rounded-lg bg-blue-600 p-2 text-sm text-white disabled:opacity-50"
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          aria-label="Распознать задачу"
        >
          {loading ? '…' : 'AI'}
        </button>
      </div>

      {recState === 'processing' && (
        <p className="mt-1 text-xs text-gray-500">Распознавание речи…</p>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      <CorrectionSheet
        open={sheetOpen}
        parse={parse}
        onConfirm={handleConfirm}
        onCancel={() => setSheetOpen(false)}
      />
    </div>
  );
}