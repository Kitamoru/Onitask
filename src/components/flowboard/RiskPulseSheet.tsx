'use client';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Card, SectionHeader } from '@/components/ui/desk-ui';
import type { FlowMetricsResponse } from '@/types/flowboard';

export type RiskPulseSignal = 'people' | 'processes';

export interface RiskPulseSheetProps {
  open: boolean;
  onClose: () => void;
  signal: RiskPulseSignal | null;
  metrics: FlowMetricsResponse | null;
  onOpenWorker?: (workerId: string) => void;
  onOpenTask?: (taskId: string) => void;
}

function formatHours(value: number | string | null | undefined): string | null {
  const hours = Number(value ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return hours >= 24 ? `${Math.round(hours / 24)} дн.` : `${Math.round(hours)} ч`;
}

export function RiskPulseSheet({ open, onClose, signal, metrics, onOpenWorker, onOpenTask }: RiskPulseSheetProps) {
  const risk = metrics?.risk;
  const breakdown = metrics?.riskBreakdown;
  if (!signal || !risk || !breakdown) return null;

  const title = signal === 'people' ? 'Люди' : 'Процессы';
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        <SectionHeader title={`${title} · ${signal === 'people' ? risk.people : risk.processes}`} />
        {signal === 'people' && (
          <div className="flex flex-col gap-3">
            {breakdown.people.length === 0 ? (
              <Card notch={8}><p className="text-sm text-text-muted">Ни у кого нет полной когнитивной нагрузки.</p></Card>
            ) : breakdown.people.map((worker) => (
              <Card key={worker.worker_id} notch={8}>
                <button type="button" className="flex w-full flex-col gap-1 text-left" onClick={() => onOpenWorker?.(worker.worker_id)}>
                  <span className="text-[15px] font-medium text-text">{worker.display_name}</span>
                  <span className="text-body-sm text-text-muted">Когнитивная нагрузка: {worker.cognitive_load}/3</span>
                  <span className="text-body-sm text-text-muted">Риск назначения: {worker.attention_risk_score}/100 · {worker.risk_level}</span>
                </button>
              </Card>
            ))}
          </div>
        )}
        {signal === 'processes' && (
          <div className="flex flex-col gap-4">
            <ProcessGroup title="Ревью-блок" rows={breakdown.processes.reviewBacklog.map((row) => ({ key: row.reviewer_id, title: row.reviewer_name || 'Ревьюер', detail: `${row.review_count} задач на проверке` }))} />
            <ProcessGroup title="Зависшие задачи" rows={breakdown.processes.stuck.map((row) => ({ key: row.id, title: row.title, detail: formatHours(row.hours_stuck) || 'Давно без движения', taskId: row.id }))} onOpenTask={onOpenTask} />
            <ProcessGroup title="Phantom-блокеры" rows={breakdown.processes.orphanBlockers.map((row) => ({ key: row.id, title: row.title, detail: formatHours(row.hours_blocked) || 'Блокер уже завершён', taskId: row.id }))} onOpenTask={onOpenTask} />
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function ProcessGroup({ title, rows, onOpenTask }: { title: string; rows: Array<{ key: string; title: string; detail: string; taskId?: string }>; onOpenTask?: (taskId: string) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-body-sm text-text-muted">Нет сигналов.</p>
      ) : rows.map((row) => (
        <Card key={row.key} notch={8}>
          <button type="button" className="flex w-full flex-col gap-1 text-left" onClick={() => row.taskId && onOpenTask?.(row.taskId)}>
            <span className="text-sm font-medium text-text">{row.title}</span>
            <span className="text-body-sm text-text-muted">{row.detail}</span>
          </button>
        </Card>
      ))}
    </section>
  );
}
