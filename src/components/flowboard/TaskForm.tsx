'use client';

/**
 * TaskForm — manual task creation form (FLOW-06).
 *
 * Creates tasks with is_inbox=false when a column is explicitly chosen,
 * or is_inbox=true when no column is specified.
 *
 * Based on: Master §5, TASKS.md Stage 4 FLOW-06
 */

'use client';

import { useState, useCallback } from 'react';
import { createTask } from '@/lib/api/flow';
import type { TaskEntity } from '@/types/flowboard';

export interface TaskFormProps {
  onSubmit?: (task: TaskEntity) => void;
  onCancel?: () => void;
  defaultColumn?: string;
  className?: string;
}

const COLUMNS = [
  { value: 'backlog', label: 'Бэклог' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
];

const PRIORITIES = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' },
  { value: 'critical', label: 'Критический' },
];

export function TaskForm({ onSubmit, onCancel, defaultColumn = 'backlog', className }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [column, setColumn] = useState(defaultColumn);
  const [priority, setPriority] = useState('medium');
  const [cognitiveWeight, setCognitiveWeight] = useState(1);
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await createTask({
        title: title.trim(),
        description: description || undefined,
        column: column !== undefined ? column : undefined,
        priority,
        cognitive_weight: cognitiveWeight,
        deadline: deadline || undefined,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.task) {
        setTitle('');
        setDescription('');
        setDeadline('');
        onSubmit?.(result.task);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания задачи');
    } finally {
      setLoading(false);
    }
  }, [title, description, column, priority, cognitiveWeight, deadline, onSubmit]);

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${className || ''}`} aria-label="Создание задачи">
      {/* Title */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Название *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Введите название задачи..."
          required
          maxLength={500}
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: '4px',
          }}
          aria-required="true"
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Описание
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание задачи..."
          rows={3}
          maxLength={5000}
          className="w-full px-3 py-2 rounded border bg-transparent text-sm resize-none"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: '4px',
          }}
        />
      </div>

      {/* Column */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Колонка
        </label>
        <select
          value={column}
          onChange={(e) => setColumn(e.target.value)}
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: '4px',
          }}
        >
          {COLUMNS.map((col) => (
            <option key={col.value} value={col.value}>
              {col.label}
            </option>
          ))}
        </select>
      </div>

      {/* Priority */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Приоритет
        </label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: '4px',
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Cognitive Weight */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Когнитивный вес
        </label>
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setCognitiveWeight(w)}
              className="flex items-center justify-center w-8 h-8 rounded border transition-colors"
              style={{
                borderColor: cognitiveWeight === w ? 'var(--color-accent-amber)' : 'var(--color-border-default)',
                backgroundColor: cognitiveWeight === w ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                fontWeight: cognitiveWeight === w ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
              }}
              aria-label={`Вес ${w}`}
              aria-pressed={cognitiveWeight === w}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Deadline */}
      <div className="flex flex-col gap-1">
        <label
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          Дедлайн
        </label>
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-full px-3 py-2 rounded border bg-transparent text-sm"
          style={{
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-base)',
            fontSize: 'var(--text-body-sm)',
            borderRadius: '4px',
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-3 py-2 rounded text-sm"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: '#FCA5A5',
            border: '1px solid #EF4444',
            borderRadius: '4px',
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="flex items-center justify-center h-10 px-6 rounded transition-colors"
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-md)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'white',
            backgroundColor: loading || !title.trim() ? 'var(--color-text-muted)' : 'var(--color-accent-amber)',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || !title.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Создание...' : 'Создать'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center h-10 px-6 rounded transition-colors hover:bg-surface/50"
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-md)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-bg-surface-hover)',
              border: `1px solid var(--color-border-default)`,
              borderRadius: '4px',
            }}
          >
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}