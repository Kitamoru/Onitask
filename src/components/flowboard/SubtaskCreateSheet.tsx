'use client';

/**
 * SubtaskCreateSheet — боттом-шит создания подзадачи (SUB-01).
 *
 * Отдельная форма вместо поля ввода прямо в блоке «Подзадачи»: там же теперь
 * только список и кнопка, а ввод с датой и исполнителем требует места.
 *
 * Состав (решение владельца, 2026-09-30): текст → срок → исполнитель →
 * «Создать подзадачу». Поле с датой переиспользовано из задачи
 * (`SingleDateField` + `SingleDateSheet`), выбор исполнителя — тот же
 * `WorkerSelectSheet`, что у задачи, но уже без агентов: подзадаче назначать
 * AI-исполнителя нельзя (v1), и показывать его в списке значило бы предлагать
 * действие, которое сервер отвергнет.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, TextArea } from '@/components/ui/desk-ui';
import { SingleDateField } from '@/components/ui/SingleDateField';
import { SingleDateSheet } from '@/components/ui/SingleDateSheet';
import { WorkerSelectSheet } from '@/components/flowboard/WorkerSelectSheet';
import ParticipantCard from '@/components/flowboard/ParticipantCard';
import { SUBTASK_TITLE_MAX } from '@/lib/subtasks';
import type { WorkerCardData } from '@/types/flowboard';

export interface SubtaskCreateInput {
  title: string;
  /** Полный текст из «Что нужно сделать» — уходит в description. */
  description?: string | null;
  assigned_to?: string | null;
  deadline?: string | null;
}

export interface SubtaskCreateSheetProps {
  open: boolean;
  onClose: () => void;
  workers: WorkerCardData[];
  /** Возвращает текст ошибки или null при успехе. */
  onCreate: (input: SubtaskCreateInput) => Promise<string | null>;
}

export function SubtaskCreateSheet({
  open,
  onClose,
  workers,
  onCreate,
}: SubtaskCreateSheetProps) {
  const [text, setText] = useState('');
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [assigneeSheetOpen, setAssigneeSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Агент-исполнитель подзадаче запрещён (SUB-01, v1) — в списке его нет.
  const humanWorkers = workers.filter((w) => w.type === 'human');
  const assignee = humanWorkers.find((w) => w.id === assigneeId) ?? null;
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const reset = () => {
    setText('');
    setDeadline(null);
    setAssigneeId(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const failure = await onCreate({
      // Текст из «Что нужно сделать» идёт и в название (для списка и TG-карточки),
      // и в описание (для шторки подзадачи). Название режется на сервере.
      title: trimmed.slice(0, SUBTASK_TITLE_MAX),
      description: trimmed,
      assigned_to: assigneeId,
      deadline: deadline ? deadline.toISOString() : null,
    });
    setSubmitting(false);
    if (failure) {
      setError(failure);
      return;
    }
    reset();
  };

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div className="flex flex-col gap-4 px-4 pb-6 pt-6">
        <h2 className="text-[19px] font-medium text-text">Добавить подзадачу</h2>

        {/* TextArea отдаёт значение строкой (не событием) и сам растёт по высоте,
            поэтому rows здесь не задаётся. */}
        <TextArea
          value={text}
          onChange={setText}
          placeholder="Что нужно сделать"
          aria-label="Что нужно сделать"
        />

        <SingleDateField
          date={deadline}
          onOpen={() => setDateSheetOpen(true)}
          placeholder="Срок"
        />

        {assignee ? (
          <ParticipantCard
            id={assignee.id}
            displayName={assignee.displayName}
            avatarUrl={assignee.avatarUrl}
            role="Исполнитель"
          />
        ) : (
          <Button variant="outline" onClick={() => setAssigneeSheetOpen(true)}>
            Выбрать исполнителя
          </Button>
        )}

        {assignee && (
          <Button variant="outline" onClick={() => setAssigneeSheetOpen(true)}>
            Сменить исполнителя
          </Button>
        )}

        {error && (
          <p className="text-[13px] text-[var(--color-priority-red-text)]">{error}</p>
        )}

        <Button
          variant="solid"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Создать подзадачу
        </Button>

        <SingleDateSheet
          open={dateSheetOpen}
          onClose={() => setDateSheetOpen(false)}
          date={deadline}
          onConfirm={setDeadline}
        />

        <WorkerSelectSheet
          open={assigneeSheetOpen}
          onClose={() => setAssigneeSheetOpen(false)}
          workers={humanWorkers}
          selectedId={assigneeId}
          title="Исполнитель подзадачи"
          onSelect={(id) => {
            setAssigneeId(id);
            setAssigneeSheetOpen(false);
          }}
        />
      </div>
    </BottomSheet>
  );
}
