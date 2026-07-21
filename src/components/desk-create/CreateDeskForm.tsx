"use client";

import { useState } from "react";
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

export type CreateDeskFormValue = {
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

export function CreateDeskForm({
  onSubmit,
  onAddColleague,
}: {
  onSubmit: (value: CreateDeskFormValue) => void;
  onAddColleague: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [spCostEnabled, setSpCostEnabled] = useState(false);
  const [spHours, setSpHours] = useState(DEFAULT_SP_HOURS);
  const [cognitiveWeightEnabled, setCognitiveWeightEnabled] = useState(false);
  const [colleagueCount] = useState(0);
  const [context, setContext] = useState("");
  const [documentsEnabled, setDocumentsEnabled] = useState(false);
  const [documents, setDocuments] = useState<File[]>([]);
  const [linksEnabled, setLinksEnabled] = useState(false);
  const [links, setLinks] = useState<ExternalLink[]>([]);
  const [trafficLightEnabled, setTrafficLightEnabled] = useState(false);
  const [warningDays, setWarningDays] = useState(1);
  const [urgentDays, setUrgentDays] = useState(3);

  const canSubmit = name.trim().length > 0 && slug.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      name,
      slug,
      spCostEnabled,
      spHours,
      cognitiveWeightEnabled,
      colleagueCount,
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
    <div className="flex flex-col w-full mx-auto max-w-[22.375rem]">
      <div className="flex flex-col gap-8 px-4 xs:px-5 sm:px-6 pb-4 pt-5">
        <BasicInfoSection
          name={name}
          onNameChange={setName}
          slug={slug}
          onSlugChange={setSlug}
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

      <div className="px-4 xs:px-5 sm:px-6 pb-6 pt-2">
        <Button variant="solid" disabled={!canSubmit} onClick={handleSubmit}>
          Создать доску
        </Button>
      </div>
    </div>
  );
}