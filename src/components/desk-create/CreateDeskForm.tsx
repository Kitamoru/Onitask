"use client";

import { useState } from "react";
import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { Button } from "@/components/ui/desk-ui/Button";
import { BasicInfoSection } from "@/components/desk-create/BasicInfoSection";
import { SprintActivationCard } from "@/components/desk-create/SprintActivationCard";
import { StoryPointCostCard } from "@/components/desk-create/StoryPointCostCard";
import { CognitiveWeightCard } from "@/components/desk-create/CognitiveWeightCard";
import { CoworkingSection } from "@/components/desk-create/CoworkingSection";
import type { ColleagueItem } from "@/components/desk-create/CoworkingSection";
import { ContextSection } from "@/components/desk-create/ContextSection";
import { DocumentsCard } from "@/components/desk-create/DocumentsCard";
import {
  ExternalLinksCard,
  type ExternalLink,
} from "@/components/desk-create/ExternalLinksCard";
import { TrafficLightCard } from "@/components/desk-create/TrafficLightCard";

const DEFAULT_SP_HOURS = { 1: "1 час", 3: "1 час", 5: "1 час", 7: "1 час", 13: "1 час" };

export type CreateDeskFormValue = {
  name: string;
  slug: string;
  spCostEnabled: boolean;
  spHours: typeof DEFAULT_SP_HOURS;
  spSprintEnabled: boolean;
  cognitiveWeightEnabled: boolean;
  /** Selected colleagues' source_ids to add as members */
  colleagueIds: string[];
  /** Total available colleagues count (for display) */
  availableColleagueCount: number;
  context: string;
  documentsEnabled: boolean;
  documents: File[];
  linksEnabled: boolean;
  links: ExternalLink[];
  trafficLightEnabled: boolean;
  warningDays: number;
  urgentDays: number;
};

export function CreateDeskForm({
  onSubmit,
  availableColleagues,
  selectedColleagues,
  onToggleColleague,
  onOpenSelect,
}: {
  onSubmit: (value: CreateDeskFormValue) => void;
  /** All available colleagues from owner workspaces */
  availableColleagues: ColleagueItem[];
  /** Currently selected colleagues */
  selectedColleagues: ColleagueItem[];
  /** Toggle a colleague selection */
  onToggleColleague: (sourceId: string) => void;
  /** Open the colleague select sheet */
  onOpenSelect: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [spCostEnabled, setSpCostEnabled] = useState(false);
  const [spHours, setSpHours] = useState(DEFAULT_SP_HOURS);
  const [spSprintEnabled, setSpSprintEnabled] = useState(false);
  const [cognitiveWeightEnabled, setCognitiveWeightEnabled] = useState(false);
  const [context, setContext] = useState("");
  const [documentsEnabled, setDocumentsEnabled] = useState(false);
  const [documents, setDocuments] = useState<File[]>([]);
  const [linksEnabled, setLinksEnabled] = useState(false);
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [trafficLightEnabled, setTrafficLightEnabled] = useState(false);
  const [warningDays, setWarningDays] = useState(3);
  const [urgentDays, setUrgentDays] = useState(1);

  const canSubmit = name.trim().length > 0 && slug.trim().length > 0;

  // Build colleague IDs array from selected items
  const colleagueIds = selectedColleagues.map((c) => c.source_id);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      name,
      slug,
      spCostEnabled,
      spHours,
      spSprintEnabled,
      cognitiveWeightEnabled,
      colleagueIds,
      availableColleagueCount: availableColleagues.length,
      context,
      documentsEnabled,
      documents,
      linksEnabled,
      links,
      trafficLightEnabled,
      warningDays,
      urgentDays,
    });
  };

  return (
    <div className="flex flex-col">
      {/* Scrollable form body – компактный нижний отступ, как раньше,
          но с учётом safe-area для iPhone с вырезом */}
      <div
        className="flex flex-col gap-6 px-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <BasicInfoSection
          name={name}
          onNameChange={setName}
          slug={slug}
          onSlugChange={setSlug}
        />

         <section>
           <SectionHeader title="Функциональное" />
           <div className="flex flex-col gap-4">
             <SprintActivationCard
               enabled={spSprintEnabled}
               onEnabledChange={setSpSprintEnabled}
             />
              {spSprintEnabled && (
                <StoryPointCostCard
                  enabled={spCostEnabled}
                  onEnabledChange={setSpCostEnabled}
                  hoursBySp={spHours}
                  onHoursChange={(sp, value) =>
                    setSpHours((prev) => ({ ...prev, [sp]: value }))
                  }
                />
              )}
             <CognitiveWeightCard
              enabled={cognitiveWeightEnabled}
              onEnabledChange={setCognitiveWeightEnabled}
            />
          </div>
        </section>

        <CoworkingSection
          availableCount={availableColleagues.length}
          selectedColleagues={selectedColleagues}
          onOpenSelect={onOpenSelect}
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

      {/* Inline CTA — компактный отступ сверху, адаптирован через safe-area */}
      <div
        className="px-4 lg:hidden"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button variant="solid" disabled={!canSubmit} onClick={handleSubmit}>
          Создать доску
        </Button>
      </div>
    </div>
  );
}
