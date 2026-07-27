'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/ui/desk-ui/SectionHeader';
import { Button } from '@/components/ui/desk-ui/Button';
import { PersonCard } from '@/components/flowboard';
import type { WorkerCardData as FlowWorkerCardData } from '@/components/flowboard';

/**
 * Extend FlowBoard's WorkerCardData for BoardDetail usage.
 * We reuse the same fields — `activeDays` maps from `activeTasks`.
 */
export type WorkerCardData = FlowWorkerCardData;

export interface ExternalLinkData {
  id: string;
  label: string;
  url: string;
}

export interface DocumentData {
  id: string;
  filename: string;
  fileType: 'markdown' | 'text';
}

export interface BoardDetailProps {
  boardName: string;
  slug: string;
  colleagues: WorkerCardData[];
  externalLinks: ExternalLinkData[];
  documents: DocumentData[];
  boardSettings?: {
    spCostEnabled: boolean;
    cognitiveWeightEnabled: boolean;
    context: string;
  };
  loading?: boolean;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between rounded-[10px] px-4 py-3"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <span className="text-[15px] text-text-muted">{label}</span>
      <span className="text-[15px] text-text">{value}</span>
    </div>
  );
}

export function BoardDetail({
  boardName,
  slug,
  colleagues,
  boardSettings,
  loading = false,
}: BoardDetailProps) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-dvh bg-bg">
        <p className="text-text-muted">Загрузка...</p>
      </div>
    );
  }

  const context = boardSettings?.context ?? '';

  return (
    <div className="flex flex-col gap-6 px-4">
      {/* Header — board name */}
      <div className="pt-1">
        <h1 className="text-[21px] font-medium leading-tight tracking-tight text-text">
          {boardName}
        </h1>
      </div>

      {/* Basic info — read-only */}
      <section>
        <SectionHeader title="Основное" />
        <div className="flex flex-col gap-3">
          <InfoRow label="ID доски" value={`@${slug}`} />
          {context && (
            <InfoRow
              label="Контекст"
              value={context.length > 50 ? context.slice(0, 50) + '…' : context}
            />
          )}
        </div>
      </section>

      {/* Colleagues section */}
      {colleagues.length > 0 && (
        <section>
          <SectionHeader title="Участники" />
          <div className="flex flex-col gap-3">
            {colleagues.map((colleague) => (
              <PersonCard key={colleague.id} person={colleague} type="worker" />
            ))}
          </div>
        </section>
      )}

      {/* Edit button — full width */}
      <Button
        variant="solid"
        onClick={() => router.push(`/board/${slug}/edit`)}
        className="w-full"
      >
        Редактировать
      </Button>

      {/* Bottom filler */}
      <div style={{ height: '80px' }} aria-hidden="true" />
    </div>
  );
}