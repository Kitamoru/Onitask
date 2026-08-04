/**
 * F-04 AI Input (F04-05).
 *
 * Text input with voice recording (F04-02) and AI task creation (F04-07).
 * On submit: calls /api/ai/create-task (полный Route Handler по §3.6 —
 * задача создаётся на сервере со всеми полями), затем условно открывает
 * CorrectionSheet (F04-06) для редактирования уже созданной задачи
 * при низком clarity_score или confidence (§3.7).
 *
 * Based on: onitask_ai_.md §3.1–§3.7
 */

'use client';

import { useState } from 'react';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { CorrectionSheet } from './CorrectionSheet';
import type { ParseResponseV2, EnrichmentStrategy } from '../../lib/ai/types';

interface AiInputProps {
  initData: string;
  onTaskCreated: (taskId: string) => void;
}

interface CreateTaskResponse {
  task: { id: string };
  parse: ParseResponseV2;
  strategy: EnrichmentStrategy;
  showCorrectionSheet: boolean;
}

export function AiInput({ initData, onTaskCreated }: AiInputProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [parse, setParse] = useState<ParseResponseV2 | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { state: recState, error: recError, start: startRec, stop: stopRec } = useVoiceRecorder({
    initData,
    onTranscribed: (text) => setInput((prev) => (prev ? prev + ' ' : '') + text),
  });

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData, input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка AI-создания задачи');

      const result = data as CreateTaskResponse;
      // Задача создана на сервере со всеми полями (raw_input, clarity, complexity, strategy…)
      if (result.showCorrectionSheet) {
        // Условный показ Correction Sheet для редактирования уже созданной задачи (§3.7)
        setTaskId(result.task.id);
        setParse(result.parse);
        setSheetOpen(true);
      } else {
        setInput('');
        onTaskCreated(result.task.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка AI-создания задачи');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = (edited: ParseResponseV2) => {
    setSheetOpen(false);
    setInput('');
    onTaskCreated(taskId ?? '');
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
          aria-label="Создать задачу"
        >
          {loading ? '…' : 'AI'}
        </button>
      </div>

      {recState === 'processing' && (
        <p className="mt-1 text-xs text-gray-500">Распознавание речи…</p>
      )}
      {recState === 'error' && recError && (
        <p className="mt-1 text-xs text-red-500">Ошибка распознавания: {recError}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      <CorrectionSheet
        open={sheetOpen}
        taskId={taskId}
        parse={parse}
        initData={initData}
        onConfirm={handleConfirm}
        onCancel={() => setSheetOpen(false)}
      />
    </div>
  );
}