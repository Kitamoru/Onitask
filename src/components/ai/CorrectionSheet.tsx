/**
 * F-04 Correction Sheet (F04-06).
 *
 * Modal that shows the AI-parsed task for user confirmation/correction.
 * По контракту §3.7 задача УЖЕ создана на сервере (/api/ai/create-task).
 * Этот sheet показывает результат для редактирования и отправляет PATCH
 * на /api/tasks/:id при подтверждении.
 *
 * Based on: onitask_ai_.md §3.6–§3.8
 */

'use client';

import { useState } from 'react';
import type { ParseResponseV2 } from '../../lib/ai/types';

interface CorrectionSheetProps {
  open: boolean;
  taskId: string | null;
  parse: ParseResponseV2 | null;
  initData: string;
  onConfirm: (edited: ParseResponseV2) => void;
  onCancel: () => void;
}

export function CorrectionSheet({ open, taskId, parse, initData, onConfirm, onCancel }: CorrectionSheetProps) {
  const [draft, setDraft] = useState<ParseResponseV2 | null>(parse);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync draft when parse changes
  if (parse && draft !== parse) {
    setDraft(parse);
  }

  if (!open || !draft) return null;

  const set = <K extends keyof ParseResponseV2>(key: K, value: ParseResponseV2[K]) => {
    setDraft({ ...draft, [key]: value });
  };

  const handleSave = async () => {
    if (!taskId) {
      onConfirm(draft);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: initData,
          title: draft.rewritten_title?.trim() || draft.title,
          description: draft.rewritten_description,
          priority: draft.priority,
          deadline: draft.deadline,
          tags: draft.tags,
          clarity_score: draft.clarity_score,
          complexity: draft.complexity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');
      onConfirm(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Проверка задачи"
    >
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h2 className="mb-1 text-lg font-semibold">Проверьте задачу</h2>
        <p className="mb-4 text-sm text-gray-500">
          AI распознал задачу. Уточните при необходимости.
        </p>

        <label className="mb-2 block text-sm font-medium">Название</label>
        <input
          className="mb-3 w-full rounded-lg border border-gray-300 p-2 text-sm"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          aria-label="Название задачи"
        />

        <label className="mb-2 block text-sm font-medium">Уточнённое название</label>
        <input
          className="mb-3 w-full rounded-lg border border-gray-300 p-2 text-sm"
          value={draft.rewritten_title}
          onChange={(e) => set('rewritten_title', e.target.value)}
          aria-label="Уточнённое название"
        />

        <label className="mb-2 block text-sm font-medium">Описание</label>
        <textarea
          className="mb-3 w-full rounded-lg border border-gray-300 p-2 text-sm"
          value={draft.rewritten_description}
          onChange={(e) => set('rewritten_description', e.target.value)}
          rows={3}
          aria-label="Описание"
        />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Приоритет</label>
            <select
              className="w-full rounded-lg border border-gray-300 p-2 text-sm"
              value={draft.priority ?? ''}
              onChange={(e) => set('priority', (e.target.value || null) as ParseResponseV2['priority'])}
              aria-label="Приоритет"
            >
              <option value="">—</option>
              <option value="high">Высокий</option>
              <option value="medium">Средний</option>
              <option value="low">Низкий</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Дедлайн</label>
            <input
              type="date"
              className="w-full rounded-lg border border-gray-300 p-2 text-sm"
              value={draft.deadline ?? ''}
              onChange={(e) => set('deadline', e.target.value || null)}
              aria-label="Дедлайн"
            />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {draft.tags.map((tag, i) => (
            <span key={i} className="rounded-full bg-gray-100 px-2 py-1 text-xs">
              {tag}
            </span>
          ))}
        </div>

        <div className="mb-4 flex items-center justify-between text-xs text-gray-500">
          <span>Ясность: {Math.round(draft.clarity_score * 100)}%</span>
          <span>Сложность: {draft.complexity}</span>
        </div>

        {error && <p className="mb-3 text-xs text-red-500">{error}</p>}

        <div className="flex gap-3">
          <button
            className="flex-1 rounded-lg border border-gray-300 p-2 text-sm font-medium"
            onClick={onCancel}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            className="flex-1 rounded-lg bg-blue-600 p-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}