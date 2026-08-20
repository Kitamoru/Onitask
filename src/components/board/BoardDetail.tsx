'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { SectionHeader } from '@/components/ui/desk-ui/SectionHeader';
import { Button } from '@/components/ui/desk-ui/Button';
import { BasicInfoSection } from '@/components/desk-create/BasicInfoSection';
import { SprintActivationCard } from '@/components/desk-create/SprintActivationCard';
import { StoryPointCostCard } from '@/components/desk-create/StoryPointCostCard';
import { CognitiveWeightCard } from '@/components/desk-create/CognitiveWeightCard';
import { CoworkingSection } from '@/components/desk-create/CoworkingSection';
import { ContextSection } from '@/components/desk-create/ContextSection';
import {
  DocumentsCard,
  type ServerDocument,
} from '@/components/desk-create/DocumentsCard';
import {
  ExternalLinksCard,
  type ExternalLink,
} from '@/components/desk-create/ExternalLinksCard';
import { TrafficLightCard } from '@/components/desk-create/TrafficLightCard';

const DEFAULT_SP_HOURS = { 1: '1 час', 3: '1 час', 5: '1 час', 7: '1 час', 13: '1 час' };

export interface BoardDetailProps {
  boardName: string;
  slug: string;
  spCostEnabled: boolean;
  spHours?: typeof DEFAULT_SP_HOURS;
  spSprintEnabled: boolean;
  cognitiveWeightEnabled: boolean;
  availableColleagueCount: number;
  selectedColleagues: import('@/components/desk-create/CoworkingSection').ColleagueItem[];
  context: string;
  documentsEnabled: boolean;
  linksEnabled: boolean;
  links: ExternalLink[];
  serverDocuments?: ServerDocument[];
  trafficLightEnabled: boolean;
  warningDays: number;
  urgentDays: number;
  loading?: boolean;
}

export function BoardDetail({
  boardName,
  slug,
  spCostEnabled,
  spHours = DEFAULT_SP_HOURS,
  spSprintEnabled,
  cognitiveWeightEnabled,
  availableColleagueCount,
  selectedColleagues,
  context,
  documentsEnabled,
  linksEnabled,
  links,
  serverDocuments = [],
  trafficLightEnabled,
  warningDays,
  urgentDays,
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

  return (
    <div className="flex flex-col">
      {/* Scrollable body — same layout as EditDeskForm, all fields disabled */}
      <div
        className="flex flex-col gap-6 px-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
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
            <SprintActivationCard
              enabled={spSprintEnabled}
              onEnabledChange={() => {}}
              disabled
            />
            {spSprintEnabled && (
              <StoryPointCostCard
                enabled={spCostEnabled}
                onEnabledChange={() => {}}
                hoursBySp={spHours}
                onHoursChange={() => {}}
                disabled
              />
            )}
            <CognitiveWeightCard
              enabled={cognitiveWeightEnabled}
              onEnabledChange={() => {}}
              disabled
            />
          </div>
        </section>

        <CoworkingSection
          availableCount={availableColleagueCount}
          selectedColleagues={selectedColleagues}
          onOpenSelect={() => {}}
          disabled
          readOnly
        />

        <ContextSection value={context} onChange={() => {}} disabled />

        <section>
          <SectionHeader title="Дополнительные материалы" />
          <div className="flex flex-col gap-4">
            <DocumentsCard
              enabled={documentsEnabled}
              onEnabledChange={() => {}}
              files={[]}
              onFilesChange={() => {}}
              serverDocuments={serverDocuments}
              disabled
              readOnly
            />
            <ExternalLinksCard
              enabled={linksEnabled}
              onEnabledChange={() => {}}
              links={links}
              onLinksChange={() => {}}
              disabled
              readOnly
            />
          </div>
        </section>

        <section>
          <SectionHeader title="Модификации" />
          <TrafficLightCard
            enabled={trafficLightEnabled}
            onEnabledChange={() => {}}
            warningDays={warningDays}
            onUrgentDaysChange={() => {}}
            urgentDays={urgentDays}
            onWarningDaysChange={() => {}}
            disabled
          />
        </section>
      </div>

      {/* Edit button — full width */}
      <div
        className="px-4 pt-2 lg:hidden"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button
          variant="solid"
          onClick={() => router.push(`/board/${slug}/edit`)}
          className="w-full"
        >
          Редактировать
        </Button>
      </div>
    </div>
  );
}