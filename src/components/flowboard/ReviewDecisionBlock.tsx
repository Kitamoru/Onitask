'use client';

/**
 * ReviewDecisionBlock — REV-01: блок решения ревьюера в карточке задачи.
 *
 * Рендерится в TaskViewEdit → «Общие», когда task.column === 'review' и текущий
 * пользователь — назначенный ревьюер (или creator, если reviewer не назначен).
 * Кнопки:
 *   - «Согласовать» → approve (review → done);
 *   - «Вернуть на доработку» → требует причину → fix (review → in_progress
 *     + комментарий source='review' + requeue агента, всё в RPC review_action 083).
 *
 * Блок «dumb»: действия и состояние (loading/error/prefill) управляются родителем.
 */

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/desk-ui';
import { TextArea } from '@/components/ui/desk-ui/TextArea';
import { canCurrentUserReview } from '@/lib/reviewDecision';
import type { TaskEntity, LatestTaskSubmission, TaskSubmissionLink } from '@/types/flowboard';

export interface ReviewDecisionBlockProps {
  /** Задача в колонке review */
  task: TaskEntity | null;
  /** Текущий пользователь (worker.id) */
  currentUserId?: string;
  /** Последняя сдача исполнителя (prefill «Что сделано»/ссылки/файлы) */
  latestSubmission: LatestTaskSubmission | null;
  /** Состояние отправки (approve/fix) */
  loading: boolean;
  /** Текст ошибки */
  error: string | null;
  onApprove: () => void;
  onFix: (reason: string) => void;
}

const REASON_MAX = 2000;

export function ReviewDecisionBlock({
  task,
  currentUserId,
  latestSubmission,
  loading,
  error,
  onApprove,
  onFix,
}: ReviewDecisionBlockProps) {
  const [showReason, setShowReason] = useState(false);
  const [localReason, setLocalReason] = useState('');

  if (!task) return null;

    // Кто может решать: назначенный ревьюер, либо creator (если reviewer не назначен),
  // либо owner/admin (форс-мейдж) — вынесено в модель reviewDecision.ts.
  const canReview = canCurrentUserReview(task, currentUserId);

  // Инфо-строка: задача на проверке, но сейчас не моя.
  if (!canReview) {
    const who = task.reviewer_id ? 'назначенного ревьюера' : 'создателя';
    return (
      <div
        className="mt-4 flex items-start gap-2 rounded-lg p-3 text-[13px]"
        style={{ backgroundColor: 'rgba(13,12,12,0.4)' }}
      >
        <AlertCircle className="mt-0.5 h-4 w-4 text-text-muted" />
        <p className="text-text-muted">
          На проверке · дождитесь решения {who}.
        </p>
      </div>
    );
  }

  const links = (latestSubmission?.links ?? []) as TaskSubmissionLink[];

  return (
    <div className="mt-4 border-t pt-4">
      {/* Заголовок */}
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-medium text-text">Ревью решения</span>
        <span className="text-[13px] text-text-muted">
          Оцените сдачу и примите решение
        </span>
      </div>

      {/* Сдача исполнителя — «Что сделано» + ссылки + файлы */}
      {latestSubmission && (
        <div className="mt-2 space-y-2 text-[14px] text-text">
          {latestSubmission.body_text
            ? <p>{latestSubmission.body_text}</p>
            : <p className="text-text-muted">— без описания —</p>}
          {links.map((link, i) => (
            <p key={`${link.url}-${i}`} className="break-all">
              🔗 {link.label ? `${link.label}: ` : ''}{link.url}
            </p>
          ))}
          {latestSubmission.files_count > 0 && (
            <p className="text-text-muted">📎 {latestSubmission.files_count} файл(ов)</p>
          )}
        </div>
      )}

      {/* Кнопки решения */}
      <div className="mt-3 flex flex-col gap-2">
        <Button
          variant="solid"
          fill="#22C573"
          textColor="#FAFAFA"
          onClick={onApprove}
          disabled={loading}
        >
          {loading ? 'Согласуем…' : '✔ Согласовать'}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowReason((v) => !v)}
          disabled={loading}
        >
          ✖ Вернуть на доработку
        </Button>
      </div>

      {/* Причина возврата */}
      {showReason && (
        <div className="mt-3 space-y-2">
                    <TextArea
            placeholder="Что не так — укажите, что поправить…"
            value={localReason}
            onChange={(value) => setLocalReason(value.slice(0, REASON_MAX))}
            className="min-h-[80px]"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowReason(false)}
              disabled={loading}
              className="flex-1"
            >
              ← Отмена
            </Button>
            <Button
              variant="solid"
              fill="#EF4444"
              textColor="#FAFAFA"
              onClick={() => onFix(localReason.trim())}
              disabled={loading || localReason.trim().length < 1}
              className="flex-1"
            >
              {loading ? 'Возвращаем…' : 'Подтвердить возврат'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--color-accent-red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}