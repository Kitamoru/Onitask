'use client';

/**
 * SubtasksSection — блок подзадач в карточке задачи (SUB-01).
 *
 * Заменяет фиктивный тоггл «Чеклист задачи»: чеклист — список пунктов внутри
 * одной задачи, а подзадачи — отдельные задачи со своими сроками,
 * исполнителями и историей. Смешивать их в одном контроле было бы ложью в UI.
 *
 * Раскладка (решение владельца, 2026-09-30): ОДИН заголовок «Подзадачи» и
 * ОДИН блок под ним — список плюс кнопка «Добавить подзадачу». Отдельного
 * заголовка, тоггла и поля ввода в блоке нет: ввод переехал в
 * SubtaskCreateSheet, который открывается по кнопке.
 *
 * В режиме просмотра пустой блок не показывается вовсе — заголовок без
 * содержимого только шумит.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Card,
  NotchedPanel,
  SectionHeader,
} from '@/components/ui/desk-ui';
import { createSubtask, getSubtasks } from '@/lib/api/subtasks';
import { deleteTask, patchTask } from '@/lib/api/flow';
import { MAX_SUBTASKS, subtaskState } from '@/lib/subtasks';
import { taskColumnLabel } from '@/lib/taskColumns';
import { formatDueShort } from '@/lib/date';
import type { TaskEntity, WorkerCardData } from '@/types/flowboard';
import { SubtaskViewSheet } from './SubtaskViewSheet';
import { SubtaskCreateSheet } from './SubtaskCreateSheet';

export interface SubtasksSectionProps {
  task: TaskEntity;
  /** Участники доски — для выбора исполнителя новой подзадачи. */
  workers: WorkerCardData[];
  /** Права на родителе: без canEdit секция read-only. */
  canEdit: boolean;
  /**
   * Право удалять подзадачу. Отдельно от canEdit: по правилам сервера удаляет
   * автор родителя или админ, а править может ещё и исполнитель. Смешивать их
   * нельзя — иначе кнопка предлагала бы действие, которое сервер отвергнет 403.
   */
  canDeleteSubtask: boolean;
  /** Режим просмотра: в нём пустой блок подзадач не показывается. */
  isView: boolean;
  /** Текущий пользователь — правило ревью при переносе подзадачи в «Сделано». */
  currentUserId: string | null | undefined;
  currentUserRole: string | null | undefined;
  /** Deep link из TG: подзадача, которую раскрыть и подсветить. */
  highlightSubtaskId?: string | null;
  /**
   * SUB-01: подзадача, которую надо ОТКРЫТЬ (тап по подзадаче в стриме).
   * Отличается от highlightSubtaskId: тот только подсвечивает строку.
   */
  openSubtaskId?: string | null;
  /** Сообщает, что шторка подзадачи закрыта — сбрасывает одноразовый запрос. */
  onSubtaskSheetClose?: () => void;
}

export function SubtasksSection({
  task,
  workers,
  canEdit,
  canDeleteSubtask,
  isView,
  currentUserId,
  currentUserRole,
  highlightSubtaskId = null,
  openSubtaskId = null,
  onSubtaskSheetClose,
}: SubtasksSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['task-subtasks', task.id] as const, [task.id]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sheetSubtaskId, setSheetSubtaskId] = useState<string | null>(null);

  /**
   * Внешний запрос на открытие (тап по подзадаче в стриме).
   *
   * Синхронизируемся ТОЛЬКО при смене значения пропа. Иначе закрытие шторки
   * обнуляло бы внутреннее состояние, а эффект открывал бы её снова — по
   * кругу, и подзадача «не закрывалась» бы.
   */
  const lastRequestedId = useRef<string | null>(null);
  useEffect(() => {
    if (!openSubtaskId) {
      lastRequestedId.current = null;
      return;
    }
    if (openSubtaskId === lastRequestedId.current) return;
    lastRequestedId.current = openSubtaskId;
    setSheetSubtaskId(openSubtaskId);
  }, [openSubtaskId]);

  const subtasksQuery = useQuery({
    queryKey,
    queryFn: () => getSubtasks(task.id),
    enabled: !!task.id,
    staleTime: 15_000,
  });

  // Мемо обязателен: `?? []` создавал бы новый массив на каждом рендере и
  // делал зависимости useMemo для открытой подзадачи нестабильными.
  const subtasks = useMemo(
    () => subtasksQuery.data?.subtasks ?? [],
    [subtasksQuery.data],
  );
  const limitReached = subtasks.length >= MAX_SUBTASKS;

  /**
   * Открытая подзадача берётся из СПИСКА, а не из снимка в state.
   *
   * Раньше state хранил сам объект на момент тапа. После PATCH список
   * инвалидировался и перечитывался, но шторка продолжала держать старый
   * объект — «сохранил, а текст прежний». Со стороны это выглядело как
   * «ничего не сохранилось», хотя PATCH отрабатывал. Теперь инвалидация
   * проезжает и в шторку.
   */
  const openSubtask = useMemo(
    () => subtasks.find((s) => s.id === sheetSubtaskId) ?? null,
    [subtasks, sheetSubtaskId],
  );

  // Подзадача удаляется общим DELETE /api/tasks/[id]: это та же строка tasks,
  // отдельный эндпоинт на удаление завёл бы второй путь каскада (вложения,
  // комментарии, коммит-история) — ровно то, чего SUB-01 избегает.
  const deleteMutation = useMutation({
    mutationFn: async (subtaskId: string) => {
      const { success, error } = await deleteTask(subtaskId);
      if (!success) throw new Error(error ?? 'Не удалось удалить подзадачу');
    },
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      setActionError(
        err instanceof Error ? err.message : 'Не удалось удалить подзадачу',
      ),
  });

  /**
   * PATCH подзадачи идёт общим patchTask: подзадача — строка tasks, отдельного
   * эндпоинта на редактирование заводить незачем. invalidate нужен, чтобы список
   * перечитал колонку и срок после смены.
   */
  const patchSubtask = useCallback(
    async (subtaskId: string, payload: Record<string, unknown>) => {
      const { warning } = await patchTask(subtaskId, payload as never);
      if (warning) return warning;
      await queryClient.invalidateQueries({ queryKey });
      return null;
    },
    [queryClient, queryKey],
  );

  const handleCreate = async (input: {
    title: string;
    description?: string | null;
    assigned_to?: string | null;
    deadline?: string | null;
  }) => {
    setActionError(null);
    try {
      await createSubtask(task.id, input);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Не удалось создать подзадачу';
    }
  };

  /**
   * Удаление из шторки подзадачи. Кнопки удаления в строке списка больше нет
   * (она перекрывала карточку) — удаление живёт только здесь, с модалкой
   * подтверждения.
   */
  const deleteSubtask = useCallback(
    async (subtaskId: string): Promise<string | null> => {
      setActionError(null);
      try {
        await deleteMutation.mutateAsync(subtaskId);
        return null;
      } catch (err) {
        return err instanceof Error
          ? err.message
          : 'Не удалось удалить подзадачу';
      }
    },
    [deleteMutation],
  );

  // Пустой блок в режиме просмотра не показываем: смотреть не на что, а
  // заголовок «Подзадачи» без содержимого только занимает место.
  const hideEmptyBlock =
    isView && subtasks.length === 0 && !subtasksQuery.isPending && !subtasksQuery.isError;
  if (hideEmptyBlock) return null;

  return (
    <section>
      <SectionHeader title="Подзадачи" />
      <Card notch={8}>
        <div className="flex flex-col gap-4">
          {subtasksQuery.isPending && (
            <div className="flex items-center gap-2 py-2 text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка подзадач…
            </div>
          )}

          {subtasksQuery.isError && (
            <div
              className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]"
              role="alert"
            >
              {subtasksQuery.error.message}
            </div>
          )}

          {subtasks.length > 0 && (
            <div className="flex flex-col gap-2">
              {subtasks.map((subtask) => {
                const state = subtaskState({
                  column: subtask.column,
                  deadline: subtask.deadline,
                });
                const isHighlighted = highlightSubtaskId === subtask.id;
                // Текст — тот же, что в шторке: description полнее обрезанного
                // title, а при его отсутствии откатываемся на title.
                const content = subtask.description?.trim() || subtask.title;
                const assignee =
                  workers.find((w) => w.id === subtask.assigned_to) ?? null;
                // Роль в доске = role_title (кастомный текст: «Маркетолог»),
                // а НЕ roleLabel: тот склеивает «Администратор доски · Маркетолог»,
                // то есть начинается с пресета доступов. Владелец попросил
                // пресет здесь не показывать.
                const assigneeRole = assignee?.roleTitle?.trim() || '';
                // Срок в правом верхнем углу; просрочка и выполнение заменяют его
                // бейджем — «дата + бейдж» перегружали бы компактную строку.
                // Токены те же, что у приоритетов.
                const badge =
                  state === 'overdue'
                    ? {
                        text: 'Просрочено',
                        bg: 'var(--color-priority-red-bg)',
                        fg: 'var(--color-priority-red-text)',
                        border: 'var(--color-priority-red-border)',
                      }
                    : state === 'done'
                      ? {
                          text: 'Выполнено',
                          bg: 'var(--color-priority-green-bg)',
                          fg: 'var(--color-priority-green-text)',
                          border: 'var(--color-priority-green-border)',
                        }
                      : null;
                return (
                  <NotchedPanel
                    key={subtask.id}
                    corner="field"
                    notch={4}
                    className="w-full"
                    contentClassName="p-3"
                  >
                      <button
                        type="button"
                        onClick={() => setSheetSubtaskId(subtask.id)}
                        className="flex w-full items-start gap-3 text-left"
                        aria-label={`Открыть подзадачу ${subtask.full_id}`}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            {/* Подсветка deep link'а — тот же amber, что у
                                результата подзадачи в ленте. */}
                            <span
                              className={`font-mono text-[11px] ${
                                isHighlighted
                                  ? 'text-[var(--color-accent-amber)]'
                                  : 'text-text-muted'
                              }`}
                            >
                              {subtask.full_id}
                            </span>
                            <span className="text-[11px] text-text-muted">
                              {/* Колонка, а не состояние: «Просрочена» — это
                                  вычисляемое состояние поверх due_date, и в
                                  строке списка оно шумит. Тот же словарь, что
                                  у связанных задач. */}
                              · {taskColumnLabel(subtask.column)}
                            </span>
                          </div>
                          <span
                            className={`line-clamp-2 text-[14px] font-medium ${
                              state === 'done' ? 'text-text-muted line-through' : 'text-text'
                            }`}
                          >
                            {content}
                          </span>
                          {assignee && (
                            // Без truncate: имя и роль показываются полностью,
                            // строка переносится. Обрезка многоточием съедала
                            // конец длинного имени или должности.
                            <span className="text-[11px] text-text-muted">
                              {assignee.displayName}
                              {assigneeRole ? ` · ${assigneeRole}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          {badge ? (
                            <span
                              className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
                              style={{
                                backgroundColor: badge.bg,
                                color: badge.fg,
                                border: `1px solid ${badge.border}`,
                              }}
                            >
                              {badge.text}
                            </span>
                          ) : (
                            subtask.deadline && (
                              <span className="whitespace-nowrap text-[11px] text-text-muted">
                                {formatDueShort(subtask.deadline)}
                              </span>
                            )
                          )}
                        </div>
                      </button>
                  </NotchedPanel>
                );
              })}
            </div>
          )}

          {actionError && (
            <div
              className="rounded border border-[var(--color-priority-red-border)] px-3 py-2 text-[13px] text-[var(--color-priority-red-text)]"
              role="alert"
            >
              {actionError}
            </div>
          )}

          {canEdit && !isView && (
            // Зелёный градиент — тот же приём, что у кнопки «Редактировать»
            // в TaskViewEdit (borderGradient grad-add-from/to на corner=action).
            // fill НЕ задаём: дефолт NotchedPanel — var(--color-surface), он же
            // у Card вокруг. Прежний var(--color-bg) давал чёрную плашку
            // внутри светлой карточки.
            <NotchedPanel
              corner="action"
              notch={8}
              borderWidth={1.5}
              borderGradient={[
                'var(--color-grad-add-from)',
                'var(--color-grad-add-to)',
              ]}
              className="h-10 w-full"
              contentClassName="h-full w-full"
            >
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                disabled={limitReached}
                aria-label={limitReached ? `Лимит подзадач — ${MAX_SUBTASKS}` : 'Добавить подзадачу'}
                className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-text disabled:opacity-40"
              >
                Добавить подзадачу
              </button>
            </NotchedPanel>
          )}
        </div>
      </Card>

      {createOpen && (
        <SubtaskCreateSheet
          open
          onClose={() => setCreateOpen(false)}
          workers={workers}
          onCreate={handleCreate}
        />
      )}

      {openSubtask && (
        <SubtaskViewSheet
          open
          onClose={() => {
            setSheetSubtaskId(null);
            // Сбрасываем и родительский запрос, иначе при следующем открытии
            // этой же задачи шторка распахнулась бы снова сама.
            lastRequestedId.current = null;
            onSubtaskSheetClose?.();
          }}
          subtask={openSubtask}
          parent={task}
          assignee={workers.find((w) => w.id === openSubtask.assigned_to) ?? null}
          workers={workers}
          canEdit={canEdit}
          canDelete={canDeleteSubtask}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onPatch={patchSubtask}
          onDelete={deleteSubtask}
        />
      )}
    </section>
  );
}
