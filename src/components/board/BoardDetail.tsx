'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button, SectionHeader } from '@/components/ui/desk-ui';
import { BasicInfoSection } from '@/components/desk-create/BasicInfoSection';
import { StoryPointCostCard } from '@/components/desk-create/StoryPointCostCard';
import { CognitiveWeightCard } from '@/components/desk-create/CognitiveWeightCard';
import { CoworkingSection } from '@/components/desk-create/CoworkingSection';
import { ContextSection } from '@/components/desk-create/ContextSection';
import { DocumentsCard } from '@/components/desk-create/DocumentsCard';
import { ExternalLinksCard, type ExternalLink } from '@/components/desk-create/ExternalLinksCard';
import { TrafficLightCard } from '@/components/desk-create/TrafficLightCard';

const DEFAULT_SP_HOURS = { 1: "1 час", 3: "1 час", 5: "1 час", 7: "1 час", 13: "1 час" };

export interface SprintInfo {
  id: string;
  name: string;
  topic: string;
  startDate: string;
  endDate: string;
  daysElapsed: number;
  totalDays: number;
}

export interface TaskCardData {
  id: string;
  title: string;
  column: string;
}

export interface WorkerCardData {
  id: string;
  displayName: string;
  avatarUrl?: string;
  cognitiveWeight: number;
  spPerDay: number;
  trendUp: boolean;
  roleLabel: string;
  activeTasks: number;
  overloaded: boolean;
  tasks: string[];
}

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
  sprint?: any;
  sprintTasks: any[];
  colleagues: any[];
  externalLinks: ExternalLink[];
  documents: any[];
  deadlineWarningDays: number;
  boardSettings?: {
    spCostEnabled: boolean;
    cognitiveWeightEnabled: boolean;
    context: string;
  };
  loading?: boolean;
}

export function BoardDetail({
  boardName,
  slug,
  sprint,
  sprintTasks,
  colleagues,
  externalLinks,
  documents,
  deadlineWarningDays,
  boardSettings,
  loading = false,
}: BoardDetailProps) {
  const router = useRouter();

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh"
        style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}
      >
        <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
      </div>
    );
  }

  const spCostEnabled = boardSettings?.spCostEnabled ?? false;
  const cognitiveWeightEnabled = boardSettings?.cognitiveWeightEnabled ?? false;
  const context = boardSettings?.context ?? '';

  return (
    <div
      className="flex flex-col min-h-screen p-4 form-container"
      style={{
        backgroundColor: 'var(--color-bg-primary-dark)',
        margin: '0 auto',
        gap: 'var(--spacing-section-gap)',
      }}
    >
      {/* Header section: icon + board name + slug */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="2" y="3" width="16" height="11" rx="1.5" stroke="var(--color-accent-amber)" strokeWidth="1.5" />
            <rect x="7" y="14" width="6" height="2" rx="0.5" fill="var(--color-accent-amber)" />
            <rect x="5" y="16" width="10" height="1" rx="0.5" fill="var(--color-accent-amber)" />
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

        <div className="flex items-center gap-1">
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-accent-amber)',
            }}
          >
            1 доска • активная:
          </span>
          <span
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              lineHeight: 'var(--text-body-sm-line)',
              fontWeight: 'var(--font-weight-medium)',
              color: 'var(--color-accent-amber)',
            }}
          >
            @{slug}
          </span>
        </div>
      </div>

      {/* Center container: read-only desk-create sections */}
      <div className="flex flex-col gap-4">
        <BasicInfoSection
          name={boardName}
          onNameChange={() => {}}
          slug={slug}
          onSlugChange={() => {}}
          disabled
        />

        <section>
          <SectionHeader title="Функциональное" />
          <div className="flex flex-col gap-4">
            <StoryPointCostCard
              enabled={spCostEnabled}
              onEnabledChange={() => {}}
              hoursBySp={DEFAULT_SP_HOURS}
              onHoursChange={() => {}}
              disabled
            />
            <CognitiveWeightCard
              enabled={cognitiveWeightEnabled}
              onEnabledChange={() => {}}
              disabled
            />
          </div>
        </section>

        <CoworkingSection
          colleagueCount={colleagues.length}
          onAddColleague={() => {}}
          disabled
        />

        <ContextSection value={context} onChange={() => {}} disabled />

        <section>
          <SectionHeader title="Дополнительные материалы" />
          <div className="flex flex-col gap-4">
            <DocumentsCard
              enabled={documents.length > 0}
              onEnabledChange={() => {}}
              files={[]}
              onFilesChange={() => {}}
              disabled
            />
            <ExternalLinksCard
              enabled={externalLinks.length > 0}
              onEnabledChange={() => {}}
              links={externalLinks}
              onLinksChange={() => {}}
              disabled
            />
          </div>
        </section>

        <section>
          <SectionHeader title="Модификации" />
          <TrafficLightCard
            enabled={false}
            onEnabledChange={() => {}}
            warningDays={deadlineWarningDays}
            onUrgentDaysChange={() => {}}
            urgentDays={1}
            onWarningDaysChange={() => {}}
            disabled
          />
        </section>
      </div>

      {/* Trailing bar: Edit button (full width) */}
      <Button variant="solid" onClick={() => router.push(`/board/${slug}/edit`)}>
        Редактировать
      </Button>

      {/* Bottom filler: 80px */}
      <div
        style={{
          height: '80px',
        }}
        aria-hidden="true"
      />
    </div>
  );
}