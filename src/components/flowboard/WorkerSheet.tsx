'use client';

/**
 * WorkerSheet — bottom sheet с деталями воркера (Figma 622:29869 / 622:30273).
 *
 * Два таба (desk-ui `Segments`):
 *  - «Статус»  — метрики (velocity, rework, forecast, gap) + задачи в `in_progress`/`review`
 *  - «Доступы»  — «Роль в доске» (кастомный текст, workers.role_title) +
 *                 «Пресет доступов» (селект owner/admin/member → workers.role),
 *                 кнопки «Сохранить»/«Отозвать доступ»;
 *                 на своей карточке: «Передать владение» (у владельца,
 *                 миграция 080) и «Покинуть доску» (у не-владельца).
 *
 * Метрики приходят из server flow metrics. Rework — уникальные задачи review → in_progress.
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Segments } from '@/components/ui/desk-ui';
import { Button } from '@/components/ui/desk-ui';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';
import { TaskCard } from '@/components/stream/StreamView';
import {
  UserAvatar,
  CognitiveWeightIndicator,
  PriorityBadge,
} from '@/components/flowboard/FlowBoard';
import type { TaskEntity, WorkerCardData, SprintInfo, EvaluationConfig } from '@/types/flowboard';
import { revokeWorkerAccess, saveWorkerAccess, transferWorkspaceOwnership, leaveWorkspace } from '@/lib/api/flow';
import {
  EDITABLE_PRESETS,
  PRESET_DESCRIPTIONS,
  PRESET_LABELS,
  formatWorkerRole,
} from '@/lib/roles';

const METRIC_WINDOW_DAYS = 14;

export type WorkerSheetTab = 'status' | 'access';

export interface WorkerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Воркер, по которому открыт sheet */
  worker?: WorkerCardData | null;
  /** Все задачи текущей доски */
  tasks: TaskEntity[];
  /** Активный спринт (если включён) */
  sprint?: SprintInfo | null;
  /** UUID текущего воркспейса (доски) */
  workspaceId?: string;
  /** Название текущего воркспейса (доски) */
  workspaceName?: string;
  /** Может ли текущий пользователь отзывать доступы (owner/admin) */
  canRevoke?: boolean;
  /** Board evaluation settings */
  evaluation: EvaluationConfig;
  /** Callback при успешном отзыве доступа */
  onRevokeSuccess?: () => void;
  /** ID воркера текущего пользователя — свою «Роль в доске» можно править всегда */
  currentWorkerId?: string;
  /** Callback при успешном сохранении доступов (получает обновлённую карточку воркера) */
  onSaveSuccess?: (updated: WorkerCardData) => void;
  /** Все human-воркеры доски — кандидаты на передачу владения */
  workspaceWorkers?: WorkerCardData[];
  /** Callback после успешной передачи владения (refresh метрик) */
  onTransferSuccess?: () => void;
  /** Callback после успешного выхода из доски (навигация на /boards) */
  onLeaveSuccess?: () => void;
}

const SEGMENTS: { value: WorkerSheetTab; label: string }[] = [
  { value: 'status', label: 'Статус' },
  { value: 'access', label: 'Доступы' },
];

export function WorkerSheet({
  open,
  onClose,
  worker,
  tasks,
  sprint,
  workspaceId,
  workspaceName,
  canRevoke,
  evaluation,
  onRevokeSuccess,
  currentWorkerId,
  onSaveSuccess,
  workspaceWorkers,
  onTransferSuccess,
  onLeaveSuccess,
}: WorkerSheetProps) {
  const [tab, setTab] = useState<WorkerSheetTab>('status');
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [transferTarget, setTransferTarget] = useState<WorkerCardData | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Reset revoke/transfer/leave state when sheet opens
  useEffect(() => {
    if (open) {
      setShowRevokeConfirm(false);
      setRevoking(false);
      setRevokeError(null);
      setShowTransferPicker(false);
      setTransferTarget(null);
      setTransferring(false);
      setTransferError(null);
      setShowLeaveConfirm(false);
      setLeaving(false);
      setLeaveError(null);
    }
  }, [open]);

  // Задачи воркера в `in_progress` (назначенные исполнителем) и `review` (проверяющий)
  const inProgressTasks = useMemo(
    () =>
      worker
        ? tasks.filter((t) => t.assigned_to === worker.id && t.column === 'in_progress')
        : [],
    [tasks, worker?.id],
  );
  const reviewTasks = useMemo(
    () =>
      worker
        ? tasks.filter((t) => t.reviewer_id === worker.id && t.column === 'review')
        : [],
    [tasks, worker?.id],
  );
  const workingTasks = useMemo(
    () =>
      worker
        ? tasks.filter(
            (t) =>
              t.assigned_to === worker.id &&
              (t.column === 'in_progress' || t.column === 'review'),
          )
        : [],
    [tasks, worker?.id],
  );

  // Метрики приходят из server flow metrics.
  const metrics = useMemo(() => {
    const velocity = evaluation.storyPointsEnabled ? (worker?.spPerDay ?? 0) : 0; // SP/день из server flow metrics
    let daysLeft = worker?.velocityWindowDays ?? METRIC_WINDOW_DAYS;
    if (sprint && sprint.isActive) {
      daysLeft = Math.max(0, sprint.totalDays - sprint.daysElapsed);
    }
    const forecastSP = velocity * daysLeft;
    const assignedSP = evaluation.storyPointsEnabled
      ? workingTasks.reduce((sum, t) => sum + (t.story_points ?? 0), 0)
      : 0;
    const gap = assignedSP - forecastSP;
    return {
      velocity,
      periodDays: worker?.velocityWindowDays ?? METRIC_WINDOW_DAYS,
      rework: worker?.reworkRate ?? 0,
      reworkCount: worker?.reworkCount ?? 0,
      daysLeft,
      forecastSP,
      assignedSP,
      gap,
    };
  }, [worker?.spPerDay, worker?.reworkRate, worker?.reworkCount, worker?.velocityWindowDays, workingTasks, sprint, evaluation.storyPointsEnabled]);

  // ─── Revoke access ────────────────────────────────────────────────────────

  const handleRevokeAccess = useCallback(async () => {
    if (!worker?.id) return;
    setRevoking(true);
    setShowRevokeConfirm(false);
    try {
      const result = await revokeWorkerAccess(worker.id);
      if (result.error) {
        setRevokeError(result.error);
        return;
      }
      onRevokeSuccess?.();
      onClose();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Ошибка отзыва доступа');
    } finally {
      setRevoking(false);
    }
  }, [worker?.id, onRevokeSuccess, onClose]);

  // Кандидаты на передачу владения: другие активные human-воркеры доски
  const transferCandidates = useMemo(() => {
    if (!worker || !workspaceWorkers) return [];
    return workspaceWorkers.filter(
      (w) => w.id !== worker.id && w.type !== 'agent' && w.role != null,
    );
  }, [worker, workspaceWorkers]);

  const isSelfOwner = !!worker && worker.role === 'owner' &&
    !!currentWorkerId && worker.id === currentWorkerId;

  const handleTransferOwnership = useCallback(async () => {
    if (!transferTarget || !workspaceId) return;
    setTransferring(true);
    setTransferError(null);
    try {
      const result = await transferWorkspaceOwnership(workspaceId, transferTarget.id);
      if (result.error) {
        setTransferError(result.error);
        return;
      }
      // Optimistic: бывший владелец (открытая карточка) становится admin —
      // кнопка «Покинуть доску» появится сразу. Refresh подтянется отдельно.
      if (worker) {
        onSaveSuccess?.({
          ...worker,
          role: 'admin',
          roleLabel: formatWorkerRole('admin', worker.roleTitle),
        });
      }
      onTransferSuccess?.();
      setShowTransferPicker(false);
      setTransferTarget(null);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Ошибка передачи владения');
    } finally {
      setTransferring(false);
    }
  }, [transferTarget, workspaceId, worker, onSaveSuccess, onTransferSuccess]);

  const handleLeaveBoard = useCallback(async () => {
    if (!workspaceId) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      const result = await leaveWorkspace(workspaceId);
      if (result.error) {
        setLeaveError(result.error);
        return;
      }
      setShowLeaveConfirm(false);
      onClose();
      onLeaveSuccess?.();
    } catch (err) {
      setLeaveError(err instanceof Error ? err.message : 'Ошибка выхода из доски');
    } finally {
      setLeaving(false);
    }
  }, [workspaceId, onClose, onLeaveSuccess]);

  // Revoke confirm — portal to body, above BottomSheet transform context
  const revokeConfirmModal =
    showRevokeConfirm &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
        onClick={() => {
          if (!revoking) setShowRevokeConfirm(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-title"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6"
          style={{ backgroundColor: '#1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="revoke-title"
            className="mb-2 text-center text-lg font-semibold"
            style={{ color: '#FAFAFA' }}
          >
            Вы точно хотите забрать доступы к доске у {worker?.displayName}?
          </p>
          <p className="mb-6 text-center text-sm" style={{ color: '#8B8B8B' }}>
            {worker?.displayName} потеряет доступ к доске «{workspaceName}» и не сможет
            взаимодействовать с задачами. Это действие необратимо.
          </p>
          {revokeError && (
            <p className="mb-4 text-center text-sm" style={{ color: '#EF4444' }}>
              {revokeError}
            </p>
          )}
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              onClick={handleRevokeAccess}
              disabled={revoking}
              fill="#EF4444"
              textColor="#FAFAFA"
            >
              {revoking ? 'Отзыв...' : 'Да, отозвать доступы'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowRevokeConfirm(false)}
              disabled={revoking}
              style={{ borderColor: '#333', color: '#8B8B8B' }}
            >
              Отмена
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  // Transfer picker — portal to body (same pattern as revoke confirm)
  const transferPickerModal =
    showTransferPicker &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
        onClick={() => {
          if (!transferring) {
            setShowTransferPicker(false);
            setTransferTarget(null);
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-picker-title"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6"
          style={{ backgroundColor: '#1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="transfer-picker-title"
            className="mb-2 text-center text-lg font-semibold"
            style={{ color: '#FAFAFA' }}
          >
            Кому передать владение доской «{workspaceName}»?
          </p>
          <p className="mb-4 text-center text-sm" style={{ color: '#8B8B8B' }}>
            Новый владелец получит полный доступ к доске. Вы станете администратором.
          </p>
          {transferCandidates.length === 0 ? (
            <p className="mb-4 text-center text-sm" style={{ color: '#8B8B8B' }}>
              На доске нет других участников — передать владение некому.
            </p>
          ) : (
            <div className="mb-4 flex max-h-64 flex-col gap-2 overflow-y-auto">
              {transferCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setTransferTarget(candidate)}
                  disabled={transferring}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
                  style={{
                    borderColor:
                      transferTarget?.id === candidate.id ? '#F59E0B' : '#333',
                    backgroundColor:
                      transferTarget?.id === candidate.id
                        ? 'rgba(245, 158, 11, 0.08)'
                        : 'transparent',
                  }}
                >
                  <UserAvatar
                    displayName={candidate.displayName}
                    avatarUrl={candidate.avatarUrl}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate"
                      style={{
                        fontFamily: 'var(--font-family-display)',
                        fontSize: 'var(--text-body-sm)',
                        fontWeight: 500,
                        color: '#FAFAFA',
                      }}
                    >
                      {candidate.displayName}
                    </span>
                    <span
                      className="block truncate"
                      style={{
                        fontFamily: 'Inter, system-ui, sans-serif',
                        fontSize: '12px',
                        color: '#8B8B8B',
                      }}
                    >
                      {candidate.roleLabel}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {transferError && (
            <p className="mb-4 text-center text-sm" style={{ color: '#EF4444' }}>
              {transferError}
            </p>
          )}
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              onClick={handleTransferOwnership}
              disabled={!transferTarget || transferring}
              fill="#F59E0B"
              textColor="#0A0A0A"
            >
              {transferring ? 'Передача...' : 'Да, передать владение'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowTransferPicker(false);
                setTransferTarget(null);
              }}
              disabled={transferring}
              style={{ borderColor: '#333', color: '#8B8B8B' }}
            >
              Отмена
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  // Leave confirm — portal to body (same pattern as revoke confirm)
  const leaveConfirmModal =
    showLeaveConfirm &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
        onClick={() => {
          if (!leaving) setShowLeaveConfirm(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-title"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6"
          style={{ backgroundColor: '#1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="leave-title"
            className="mb-2 text-center text-lg font-semibold"
            style={{ color: '#FAFAFA' }}
          >
            Вы точно хотите покинуть доску «{workspaceName}»?
          </p>
          <p className="mb-6 text-center text-sm" style={{ color: '#8B8B8B' }}>
            Вы потеряете доступ к доске «{workspaceName}» и не сможете
            взаимодействовать с задачами. Это действие необратимо.
          </p>
          {leaveError && (
            <p className="mb-4 text-center text-sm" style={{ color: '#EF4444' }}>
              {leaveError}
            </p>
          )}
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              onClick={handleLeaveBoard}
              disabled={leaving}
              fill="#EF4444"
              textColor="#FAFAFA"
            >
              {leaving ? 'Выход...' : 'Да, покинуть доску'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowLeaveConfirm(false)}
              disabled={leaving}
              style={{ borderColor: '#333', color: '#8B8B8B' }}
            >
              Отмена
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
      {worker ? (
        <div className="flex flex-col gap-6 px-4 pb-6" aria-label="Воркер">
        {/* 1. Header — worker card (Figma 622:29872) */}
        <WorkerHeader worker={worker} evaluation={evaluation} />

        {/* 2. Сегменты — Статус / Доступы */}
        <Segments<WorkerSheetTab>
          options={SEGMENTS}
          value={tab}
          onChange={setTab}
          aria-label="Вкладки воркера"
        />

        {tab === 'status' && (
          <div className="flex flex-col gap-6">
            <StatusMetrics metrics={metrics} evaluation={evaluation} />
            <TaskSection
              color="var(--color-accent-amber)"
              title="В работе"
              tasks={inProgressTasks}
              emptyNote="Нет задач в работе"
            />
            <TaskSection
              color="var(--color-signal-cyan)"
              title={`На проверке (${reviewTasks.length})`}
              tasks={reviewTasks}
              emptyNote="На проверке пока нет задач"
            />
          </div>
        )}

        {tab === 'access' && (
          <AccessTab
            worker={worker}
            canRevoke={canRevoke}
            currentWorkerId={currentWorkerId}
            onRevoke={() => setShowRevokeConfirm(true)}
            onSaveSuccess={onSaveSuccess}
            isSelfOwner={isSelfOwner}
            hasTransferCandidates={transferCandidates.length > 0}
            onTransferClick={() => setShowTransferPicker(true)}
            onLeaveClick={() => setShowLeaveConfirm(true)}
          />
        )}
        </div>
      ) : null}
    </BottomSheet>

      {/* Revoke confirm — portal above BottomSheet transform context */}
      {revokeConfirmModal}
      {transferPickerModal}
      {leaveConfirmModal}
    </>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────────

function WorkerHeader({
  worker,
  evaluation,
}: {
  worker: WorkerCardData;
  evaluation: EvaluationConfig;
}) {
  return (
    <NotchedPanel
      corner="action"
      radius={4}
      notch={8}
      borderWidth={1}
      border="var(--color-line)"
      fill="var(--color-surface)"
      contentClassName="flex flex-col gap-2 p-3"
      aria-label={`${worker.displayName}${worker.roleLabel ? `, ${worker.roleLabel}` : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <UserAvatar displayName={worker.displayName} avatarUrl={worker.avatarUrl} />
          {evaluation.cognitiveWeightEnabled && <CognitiveWeightIndicator weight={worker.cognitiveWeight} />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-md)',
                lineHeight: 'var(--text-body-md-line)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
              }}
            >
              {worker.displayName}
            </span>
            {evaluation.cognitiveWeightEnabled && worker.overloaded && <PriorityBadge label="Перегружен" color="red" />}
          </div>
          <p
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-text-muted)',
            }}
          >
            {worker.roleLabel}
          </p>
        </div>
      </div>
    </NotchedPanel>
  );
}
// ─── Status: метрики ───────────────────────────────────────────────────────────

interface StatusMetricsProps {
  evaluation: EvaluationConfig;
  metrics: {
    velocity: number;
    periodDays: number;
    rework: number;
    reworkCount: number;
    forecastSP: number;
    assignedSP: number;
    gap: number;
  };
}

function MetricCard({
  value,
  sub,
  caption,
}: {
  value: string;
  sub: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <span
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: '14px',
          lineHeight: '18px',
          fontWeight: 500,
          color: '#FAFAFA',
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          color: '#8B8B8B',
        }}
      >
        {sub}
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '11px',
          lineHeight: '14px',
          color: '#8B8B8B',
        }}
      >
        {caption}
      </span>
    </div>
  );
}

function StatusMetrics({ metrics, evaluation }: StatusMetricsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {evaluation.storyPointsEnabled ? (
        <MetricCard
          value={String(metrics.velocity)}
          sub={`${metrics.velocity} SP/день · ${metrics.periodDays}д`}
          caption="Скорость"
        />
      ) : null}
      <MetricCard
        value={String(metrics.reworkCount)}
        sub={`${Math.round(metrics.rework * 100)}% возвратов · ${metrics.periodDays}д`}
        caption="Возвраты"
      />

      {evaluation.storyPointsEnabled && (
        <div className="col-span-2 flex flex-col gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <MetricRow label="Прогноз" value={`${metrics.forecastSP.toFixed(1)} SP`} muted />
          <MetricRow label="Назначено" value={`${metrics.assignedSP} SP`} accent />
          {metrics.gap > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-family-display)',
                fontSize: 'var(--text-body-sm)',
                lineHeight: '18px',
                fontWeight: 500,
                color: '#EF4444',
              }}
            >{`Gap +${metrics.gap.toFixed(1)} SP → риск`}</span>
          )}
        </div>
      )}
    </div>
  );
}

function MetricRow({
  label,
  value,
  muted = false,
  accent = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: muted ? '#8B8B8B' : '#FAFAFA',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: accent ? '#F59E0B' : '#FAFAFA',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Status: секции задач ──────────────────────────────────────────────────────

function TaskSection({
  color,
  title,
  tasks,
  emptyNote,
}: {
  color: string;
  title: string;
  tasks: TaskEntity[];
  emptyNote: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div
          style={{ width: 2, height: 18, borderRadius: 2, backgroundColor: color }}
          aria-hidden="true"
        />
        <h3
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: '14px',
            lineHeight: '18px',
            fontWeight: 500,
            color: '#FAFAFA',
          }}
        >
          {title}
        </h3>
      </div>

      {tasks.length === 0 ? (
        <p
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: 'var(--text-body-sm-line)',
            color: '#8B8B8B',
          }}
        >
          {emptyNote}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Access tab ────────────────────────────────────────────────────────────────

interface AccessTabProps {
  worker: WorkerCardData;
  /** Может ли текущий пользователь менять пресеты и чужие роли (owner/admin) */
  canRevoke?: boolean;
  /** ID воркера текущего пользователя (свою роль можно править всегда) */
  currentWorkerId?: string;
  onRevoke?: () => void;
  onSaveSuccess?: (updated: WorkerCardData) => void;
  /** Своё карточка + текущий пользователь — владелец доски */
  isSelfOwner?: boolean;
  /** Есть ли кандидаты на передачу владения (другие активные human-воркеры) */
  hasTransferCandidates?: boolean;
  /** Открыть пикер преемника (владелец, своя карточка) */
  onTransferClick?: () => void;
  /** Открыть confirm выхода из доски (не-владелец, своя карточка) */
  onLeaveClick?: () => void;
}

function AccessTab({
  worker,
  canRevoke,
  currentWorkerId,
  onRevoke,
  onSaveSuccess,
  isSelfOwner,
  hasTransferCandidates,
  onTransferClick,
  onLeaveClick,
}: AccessTabProps) {
  const isAgent = worker.type === 'agent' || worker.role == null;
  const isOwner = worker.role === 'owner';
  const isSelf = !!currentWorkerId && worker.id === currentWorkerId;
  // Пресет: owner/admin, кроме owner-цели и самого себя.
  const canEditPreset = !isAgent && !isOwner && !!canRevoke && !isSelf;
  // Должность: своя — всегда, чужая — owner/admin.
  const canEditTitle = !isAgent && (isSelf || !!canRevoke);

  const [roleTitle, setRoleTitle] = useState(worker.roleTitle ?? '');
  const [preset, setPreset] = useState(worker.role ?? 'member');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync при обновлении воркера после сохранения/refresh
  useEffect(() => {
    setRoleTitle(worker.roleTitle ?? '');
    setPreset(worker.role ?? 'member');
  }, [worker.id, worker.role, worker.roleTitle]);

  const titleDirty = canEditTitle && roleTitle.trim() !== (worker.roleTitle ?? '');
  const presetDirty = canEditPreset && preset !== (worker.role ?? 'member');
  const dirty = titleDirty || presetDirty;
  const canSave = dirty && !saving;

  const handleSave = useCallback(async () => {
    if (!worker.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: { preset?: 'admin' | 'member'; role_title?: string | null } = {};
      if (presetDirty) body.preset = preset as 'admin' | 'member';
      if (titleDirty) {
        const trimmed = roleTitle.trim();
        body.role_title = trimmed === '' ? null : trimmed;
      }

      const result = await saveWorkerAccess(worker.id, body);
      if (result.error) {
        setSaveError(result.error);
        return;
      }

      // Optimistic: обновляем карточку в родителе (refresh подтянется отдельно)
      const newRole = presetDirty ? preset : worker.role;
      const newTitle = titleDirty ? roleTitle.trim() || null : (worker.roleTitle ?? null);
      onSaveSuccess?.({
        ...worker,
        role: newRole,
        roleTitle: newTitle,
        roleLabel: formatWorkerRole(newRole, newTitle),
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [worker, presetDirty, titleDirty, preset, roleTitle, onSaveSuccess]);

  return (
    <div className="flex flex-col gap-6">
      {/* Роль в доске — кастомный текст (должность) */}
      <FieldGroup label="Роль в доске">
        {isAgent ? (
          <ReadOnlyField value="AI-агент" />
        ) : canEditTitle ? (
          <input
            type="text"
            value={roleTitle}
            maxLength={50}
            placeholder="Например: Маркетолог"
            onChange={(e) => setRoleTitle(e.target.value)}
            className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 outline-none placeholder:text-[#8B8B8B] focus:border-[var(--color-text-muted)]"
            style={{
              height: 40,
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '14px',
              lineHeight: '20px',
              fontWeight: 500,
              color: '#FAFAFA',
            }}
          />
        ) : (
          <ReadOnlyField value={roleTitle || '—'} />
        )}
      </FieldGroup>

      {/* Пресет доступов — селект (Владелец/Администратор/Участник доски) */}
      <FieldGroup label="Пресет доступов">
        {isAgent ? (
          <ReadOnlyField value="—" />
        ) : isOwner ? (
          <>
            <ReadOnlyField value={PRESET_LABELS.owner} />
            <HelperText>{PRESET_DESCRIPTIONS.owner}</HelperText>
          </>
        ) : canEditPreset ? (
          <>
            <div className="relative">
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                aria-label="Пресет доступов"
                className="w-full appearance-none rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 outline-none"
                style={{
                  height: 40,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: '14px',
                  lineHeight: '20px',
                  fontWeight: 500,
                  color: '#FAFAFA',
                }}
              >
                {EDITABLE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {PRESET_LABELS[p]}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                width={20}
                height={20}
                viewBox="0 0 17 17"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4.25 6.25L8.5 10.5L12.75 6.25"
                  stroke="#8B8B8B"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <HelperText>
              «{PRESET_LABELS[preset]}» — {PRESET_DESCRIPTIONS[preset]}
            </HelperText>
          </>
        ) : (
          <>
            <ReadOnlyField value={PRESET_LABELS[preset] ?? PRESET_LABELS.member} />
            <HelperText>Менять пресет может владелец или администратор доски</HelperText>
          </>
        )}
      </FieldGroup>

      {/* Кнопки */}
      <div className="flex flex-col gap-4">
        {saveError && (
          <p
            className="text-center"
            style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '12px',
              lineHeight: '14px',
              color: '#EF4444',
            }}
          >
            {saveError}
          </p>
        )}
        <Button
          type="button"
          variant="solid"
          disabled={!canSave}
          onClick={handleSave}
        >
          {saving ? 'Сохранение...' : 'Сохранить информацию'}
        </Button>
        <span
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-body-sm)',
            lineHeight: '18px',
            fontWeight: 500,
            color: '#8B8B8B',
            textAlign: 'center',
          }}
          className="text-center"
        >
                    вы также можете
        </span>
        {isSelfOwner ? (
          <Button
            type="button"
            variant="outline"
            onClick={onTransferClick}
            disabled={!hasTransferCandidates}
          >
            Передать владение
          </Button>
        ) : canRevoke ? (
          <Button
            type="button"
            variant="outline"
            onClick={onRevoke}
          >
            Отозвать доступы
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled
          >
            Отозвать доступы
          </Button>
        )}
        {/* Своя карточка не-владельца (человека) — выход из доски.
            У владельца кнопка появляется только после передачи владения. */}
        {isSelf && !isAgent && !isSelfOwner && (
          <Button
            type="button"
            variant="outline"
            onClick={onLeaveClick}
          >
            Покинуть доску
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: '#8B8B8B',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnlyField({ value }: { value: string }) {
  return (
    <div
      className="flex w-full items-center rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
      style={{ height: 40 }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          lineHeight: '20px',
          fontWeight: 500,
          color: '#FAFAFA',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function HelperText({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '12px',
        lineHeight: '14px',
        fontWeight: 400,
        color: '#8B8B8B',
      }}
    >
      {children}
    </p>
  );
}

