"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { Button } from "@/components/ui/desk-ui/Button";
import { BasicInfoSection } from "@/components/desk-create/BasicInfoSection";
import { StoryPointCostCard } from "@/components/desk-create/StoryPointCostCard";
import { CognitiveWeightCard } from "@/components/desk-create/CognitiveWeightCard";
import { CoworkingSection } from "@/components/desk-create/CoworkingSection";
import { ContextSection } from "@/components/desk-create/ContextSection";
import { DocumentsCard } from "@/components/desk-create/DocumentsCard";
import {
  ExternalLinksCard,
  type ExternalLink,
} from "@/components/desk-create/ExternalLinksCard";
import { TrafficLightCard } from "@/components/desk-create/TrafficLightCard";

const DEFAULT_SP_HOURS = { 1: "1 час", 3: "1 час", 5: "1 час", 7: "1 час", 13: "1 час" };

export type EditDeskFormValue = {
  name: string;
  slug: string;
  spCostEnabled: boolean;
  spHours: typeof DEFAULT_SP_HOURS;
  cognitiveWeightEnabled: boolean;
  colleagueCount: number;
  context: string;
  documentsEnabled: boolean;
  documents: File[];
  linksEnabled: boolean;
  links: ExternalLink[];
  trafficLightEnabled: boolean;
  warningDays: number;
  urgentDays: number;
};

export function EditDeskForm({
  workspaceId,
  initialData,
  onAddColleague,
}: {
  workspaceId: string;
  initialData: {
    name: string;
    slug: string;
    spCostEnabled: boolean;
    spHours?: typeof DEFAULT_SP_HOURS;
    cognitiveWeightEnabled: boolean;
    context: string;
    documentsEnabled: boolean;
    linksEnabled: boolean;
    links: ExternalLink[];
    trafficLightEnabled: boolean;
    warningDays: number;
    urgentDays: number;
  };
  onAddColleague: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialData.name);
  const [slug, setSlug] = useState(initialData.slug);
  const [spCostEnabled, setSpCostEnabled] = useState(initialData.spCostEnabled);
  const [spHours, setSpHours] = useState(initialData.spHours || DEFAULT_SP_HOURS);
  const [cognitiveWeightEnabled, setCognitiveWeightEnabled] = useState(initialData.cognitiveWeightEnabled);
  const [colleagueCount] = useState(0);
  const [context, setContext] = useState(initialData.context);
  const [documentsEnabled, setDocumentsEnabled] = useState(initialData.documentsEnabled);
  const [documents, setDocuments] = useState<File[]>([]);
  const [linksEnabled, setLinksEnabled] = useState(initialData.linksEnabled);
  const [links, setLinks] = useState<ExternalLink[]>(initialData.links);
  const [trafficLightEnabled, setTrafficLightEnabled] = useState(initialData.trafficLightEnabled);
  const [warningDays, setWarningDays] = useState(initialData.warningDays);
  const [urgentDays, setUrgentDays] = useState(initialData.urgentDays);

  const canSubmit = name.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    
    setSaving(true);
    setError(null);

    try {
      const initData = typeof window !== 'undefined' 
        ? (window as any).Telegram?.WebApp?.initData || ''
        : '';

      const res = await fetch('/api/workspaces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: initData,
          workspace_id: workspaceId,
          name,
          workspace_context: context,
          external_links: linksEnabled ? links : [],
          deadline_signals: [
            { value: 1, label: '1 день' },
            { value: 3, label: '3 дня' },
          ],
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update workspace');
      }

      // Success - navigate back to board
      router.push(`/board/${slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('Failed to update workspace:', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Scrollable form body */}
      <div
        className="flex flex-col gap-6 px-4 pt-5"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {error && (
          <div
            className="px-4 py-3 rounded"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--color-error)',
            }}
          >
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-body-sm)' }}>
              {error}
            </p>
          </div>
        )}

        <BasicInfoSection
          name={name}
          onNameChange={setName}
          slug={slug}
          onSlugChange={setSlug}
          disabled
        />

        <section>
          <SectionHeader title="Функциональное" />
          <div className="flex flex-col gap-4">
            <StoryPointCostCard
              enabled={spCostEnabled}
              onEnabledChange={setSpCostEnabled}
              hoursBySp={spHours}
              onHoursChange={(sp, value) =>
                setSpHours((prev) => ({ ...prev, [sp]: value }))
              }
            />
            <CognitiveWeightCard
              enabled={cognitiveWeightEnabled}
              onEnabledChange={setCognitiveWeightEnabled}
            />
          </div>
        </section>

        <CoworkingSection
          colleagueCount={colleagueCount}
          onAddColleague={onAddColleague}
        />

        <ContextSection value={context} onChange={setContext} />

        <section>
          <SectionHeader title="Дополнительные материалы" />
          <div className="flex flex-col gap-4">
            <DocumentsCard
              enabled={documentsEnabled}
              onEnabledChange={setDocumentsEnabled}
              files={documents}
              onFilesChange={setDocuments}
            />
            <ExternalLinksCard
              enabled={linksEnabled}
              onEnabledChange={setLinksEnabled}
              links={links}
              onLinksChange={setLinks}
            />
          </div>
        </section>

        <section>
          <SectionHeader title="Модификации" />
          <TrafficLightCard
            enabled={trafficLightEnabled}
            onEnabledChange={setTrafficLightEnabled}
            warningDays={warningDays}
            onUrgentDaysChange={setUrgentDays}
            urgentDays={urgentDays}
            onWarningDaysChange={setWarningDays}
          />
        </section>
      </div>

      {/* Inline CTA */}
      <div
        className="px-4 pt-2 lg:hidden"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button 
          variant="solid" 
          disabled={!canSubmit || saving} 
          onClick={handleSubmit}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}