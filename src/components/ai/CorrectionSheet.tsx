/**
 * F-04 Correction Sheet (F04-06).
 *
 * Modal that shows the AI-parsed task for user confirmation/correction
 * before it is created. Displays title, rewritten_title, description,
 * priority, assignee, deadline, tags, clarity_score, complexity.
 *
 * Based on: onitask_ai_.md §3.6 (Correction Sheet)
 */

'use client';

import { useState } from 'react';
import type { ParseResponseV2 } from '../../lib/ai/types';

interface CorrectionSheetProps {
  open: boolean;
  parse: ParseResponseV2 | null;
  onConfirm: (edited: ParseResponseV2) => void;
  onCancel: () => void;
}

export function CorrectionSheet({ open, parse, onConfirm, onCancel }: CorrectionSheetProps) {
  const [draft, setDraft] = useState<ParseResponseV2 | null>(parse);

  // Sync draft when parse changes
  if (parse && draft !== parse) {
    setDraft(parse);
  }

  if (!open || !draft) return null;

  const set = <K extends keyof ParseResponseV2>(key: K, value: ParseResponseV2[K]) => {
    setDraft({ ...draft, [key]: value });
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

        <div className="flex gap-3">
          <button
            className="flex-1 rounded-lg border border-gray-300 p-2 text-sm font-medium"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="flex-1 rounded-lg bg-blue-600 p-2 text-sm font-medium text-white"
            onClick={() => onConfirm(draft)}
          >
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}