'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/desk-ui';
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
    <div className="flex items-center justify-between px-3 py-2 rounded" style={{ backgroundColor: 'var(--color-bg-surface)' }}>
      <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-sm)', color: 'var(--color-text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0" style={{ width: '2px', height: '18px', backgroundColor: 'var(--color-accent-amber)', borderRadius: '2px' }} aria-hidden="true" />
      <h2 style={{ fontFamily: 'var(--font-family-display)', fontSize: 'var(--text-body-md)', fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
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
      <div className="flex items-center justify-center h-full min-h-dvh" style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
      </div>
    );
  }

  const context = boardSettings?.context ?? '';

  return (
    <div
      className="flex flex-col min-h-screen p-4"
      style={{
        backgroundColor: 'var(--color-bg-primary-dark)',
        margin: '0 auto',
        gap: 'var(--spacing-section-gap)',
      }}
    >
      {/* Header: icon + board name */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="16" height="11" rx="1.5" stroke="#FFFFFF" strokeWidth="1.5" />
            <rect x="7" y="14" width="6" height="2" rx="0.5" fill="#FFFFFF" />
            <rect x="5" y="16" width="10" height="1" rx="0.5" fill="#FFFFFF" />
          </svg>
          <h1
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'clamp(1.25rem, 2vw, 1.25rem)',
              lineHeight: '1.5',
              fontWeight: 'var(--font-weight-medium)',
              letterSpacing: '-0.025em',
              color: 'var(--color-text-primary)',
            }}
          >
            {boardName}
          </h1>
        </div>
      </div>

      {/* Center content */}
      <div className="flex flex-col gap-4">
        {/* Basic info — read-only */}
        <section className="flex flex-col gap-3">
          <SectionHeader title="Основное" />
          <div className="flex flex-col gap-2">
            <InfoRow label="ID доски" value={`@${slug}`} />
            {context && <InfoRow label="Контекст" value={context.length > 50 ? context.slice(0, 50) + '…' : context} />}
          </div>
        </section>

        {/* Colleagues section using PersonCard from flowboard */}
        {colleagues.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionHeader title="Участники" />
            <div className="flex flex-col gap-3">
              {colleagues.map((colleague) => (
                <PersonCard key={colleague.id} person={colleague} type="worker" />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Edit button */}
      <Button variant="solid" onClick={() => router.push(`/board/${slug}/edit`)}>
        Редактировать
      </Button>

      {/* Bottom filler */}
      <div style={{ height: '80px' }} aria-hidden="true" />
    </div>
  );
}