"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SectionHeader } from "@/components/ui/desk-ui/SectionHeader";
import { Button } from "@/components/ui/desk-ui/Button";
import { BasicInfoSection } from "@/components/desk-create/BasicInfoSection";
import { SprintActivationCard } from "@/components/desk-create/SprintActivationCard";
import { StoryPointCostCard } from "@/components/desk-create/StoryPointCostCard";
import { CognitiveWeightCard } from "@/components/desk-create/CognitiveWeightCard";
import { CoworkingSection } from "@/components/desk-create/CoworkingSection";
import { ContextSection } from "@/components/desk-create/ContextSection";
import { DocumentsCard, type ServerDocument } from "@/components/desk-create/DocumentsCard";
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
  spSprintEnabled: boolean;
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
  serverDocuments,
  isOwner,
  onAddColleague,
}: {
  workspaceId: string;
  initialData: {
    name: string;
    slug: string;
    spCostEnabled: boolean;
    spHours?: typeof DEFAULT_SP_HOURS;
    spSprintEnabled: boolean;
    cognitiveWeightEnabled: boolean;
    context: string;
    documentsEnabled: boolean;
    linksEnabled: boolean;
    links: ExternalLink[];
    trafficLightEnabled: boolean;
    warningDays: number;
    urgentDays: number;
  };
  serverDocuments?: ServerDocument[];
  isOwner: boolean;
  onAddColleague: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  // Store original values for rollback on save failure
  const originalValuesRef = useRef({
    name: initialData.name,
    slug: initialData.slug,
    spCostEnabled: initialData.spCostEnabled,
    spSprintEnabled: initialData.spSprintEnabled,
    cognitiveWeightEnabled: initialData.cognitiveWeightEnabled,
    context: initialData.context,
    documentsEnabled: initialData.documentsEnabled,
    linksEnabled: initialData.linksEnabled,
    links: initialData.links,
    trafficLightEnabled: initialData.trafficLightEnabled,
    warningDays: initialData.warningDays,
    urgentDays: initialData.urgentDays,
  });

  const [name, setName] = useState(initialData.name);
  const [slug, setSlug] = useState(initialData.slug);
  const [spCostEnabled, setSpCostEnabled] = useState(initialData.spCostEnabled);
  const [spHours, setSpHours] = useState(initialData.spHours || DEFAULT_SP_HOURS);
  const [spSprintEnabled, setSpSprintEnabled] = useState(initialData.spSprintEnabled ?? false);
  const [cognitiveWeightEnabled, setCognitiveWeightEnabled] = useState(initialData.cognitiveWeightEnabled);
  const [colleagueCount] = useState(0);
  const [context, setContext] = useState(initialData.context);
  const [documentsEnabled, setDocumentsEnabled] = useState(initialData.documentsEnabled);
  // Local files for new uploads (edit flow)
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  // Server documents state (for deletion tracking)
  const [docs, setDocs] = useState<ServerDocument[]>(serverDocuments ?? []);
  const [linksEnabled, setLinksEnabled] = useState(initialData.linksEnabled);
  const [links, setLinks] = useState<ExternalLink[]>(initialData.links);
  const [trafficLightEnabled, setTrafficLightEnabled] = useState(initialData.trafficLightEnabled);
  const [warningDays, setWarningDays] = useState(initialData.warningDays);
  const [urgentDays, setUrgentDays] = useState(initialData.urgentDays);

  const canSubmit = name.trim().length > 0;

  function getTelegramInitData(): string {
    if (typeof window !== 'undefined') {
      return (window as any).Telegram?.WebApp?.initData || '';
    }
    return '';
  }

  /**
   * Upload local files to the workspace documents endpoint.
   */
  const uploadLocalFiles = async (): Promise<boolean> => {
    if (!localFiles.length) return true;

    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of localFiles) {
        formData.append('files', file);
      }

      const res = await fetch(`/api/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        headers: {
          'x-telegram-init-data': getTelegramInitData(),
        },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        console.error('Document upload failed:', errData);
        return false;
      }

      // Refresh document list
      const docsRes = await fetch(`/api/workspaces/${workspaceId}/documents`, {
        method: 'GET',
        headers: {
          'x-telegram-init-data': getTelegramInitData(),
        },
      });

      if (docsRes.ok) {
        const docsJson = await docsRes.json();
        if (docsJson.success) {
          setDocs(docsJson.data?.documents ?? []);
        }
      }

      // Clear local files after successful upload
      setLocalFiles([]);
      return true;
    } catch (err) {
      console.error('Document upload error:', err);
      return false;
    } finally {
      setUploading(false);
    }
  };

  /**
   * Delete the entire workspace (cascading).
   */
  const handleDeleteWorkspace = async () => {
    setDeletingWorkspace(true);
    setShowDeleteConfirm(false);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: getTelegramInitData(),
          workspace_id: workspaceId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete workspace');
      }

      // Success - navigate to boards list
      router.push('/boards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Не удалось удалить доску: ${message}`);
      console.error('Failed to delete workspace:', message);
    } finally {
      setDeletingWorkspace(false);
    }
  };

  /**
   * Delete a server-stored document.
   */
  const handleDeleteDocument = async (documentId: string) => {
    setDeletingId(documentId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'x-telegram-init-data': getTelegramInitData(),
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        console.error('Document delete failed:', errData);
        alert(`Не удалось удалить документ: ${errData.error || res.statusText}`);
        return;
      }

      // Update local state only on success
      setDocs((prev) => prev.filter((d) => d.id !== documentId));
    } catch (err) {
      console.error('Document delete error:', err);
      alert('Произошла ошибка при удалении документа');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;

    setSaving(true);
    setError(null);

    // Optimistic UI: immediately reflect changes in the UI
    // by updating local state variables before the API call completes
    const optimisticName = name;
    const optimisticContext = context;
    const optimisticLinks = links;

    try {
      // First, upload any local files (this is inherently not optimistic - must succeed)
      const uploadSuccess = await uploadLocalFiles();
      if (!uploadSuccess) {
        throw new Error('Не удалось загрузить документы');
      }

      const initData = getTelegramInitData();

      const res = await fetch('/api/workspaces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          init_data: initData,
          workspace_id: workspaceId,
          name,
          enable_cognitive_budget: cognitiveWeightEnabled,
          workspace_context: context || undefined,
          external_links: linksEnabled ? links : [],
          deadline_signals: trafficLightEnabled
            ? [
                { value: warningDays, label: `${warningDays} ${labelDays(warningDays)}` },
                { value: urgentDays, label: `${urgentDays} ${labelDays(urgentDays)}` },
              ]
            : [{ value: 3, label: '3 дня' }, { value: 1, label: '1 день' }],
          story_points_config: {
            enabled: spCostEnabled,
            sprint_enabled: spSprintEnabled,
            hours_per_sp: spHours,
          },
          doc_kb_enabled: documentsEnabled,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update workspace');
      }

      // Success - navigate to boards list
      router.push('/boards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      
      // Rollback: restore original values on failure
      setName(originalValuesRef.current.name);
      setContext(originalValuesRef.current.context);
      setLinks(originalValuesRef.current.links);
      setLinksEnabled(originalValuesRef.current.linksEnabled);
      setSpCostEnabled(originalValuesRef.current.spCostEnabled);
      setSpSprintEnabled(originalValuesRef.current.spSprintEnabled);
      setCognitiveWeightEnabled(originalValuesRef.current.cognitiveWeightEnabled);
      setDocumentsEnabled(originalValuesRef.current.documentsEnabled);
      setTrafficLightEnabled(originalValuesRef.current.trafficLightEnabled);
      setWarningDays(originalValuesRef.current.warningDays);
      setUrgentDays(originalValuesRef.current.urgentDays);
      
      setError(`Не удалось сохранить: ${message}`);
      console.error('Failed to update workspace:', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Scrollable form body */}
      <div
        className="flex flex-col gap-6 px-4"
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
          availableCount={0}
          selectedColleagues={[]}
          onOpenSelect={() => {}}
          readOnly
          disabled
        />

        <ContextSection value={context} onChange={setContext} />

        <section>
          <SectionHeader title="Дополнительные материалы" />
          <div className="flex flex-col gap-4">
            <DocumentsCard
              enabled={documentsEnabled}
              onEnabledChange={setDocumentsEnabled}
              files={localFiles}
              onFilesChange={setLocalFiles}
              serverDocuments={docs}
              onDeleteServerDocument={handleDeleteDocument}
              uploading={uploading}
              deletingId={deletingId}
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

      {/* Delete confirmation modal */}
      {showDeleteConfirm && isOwner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ backgroundColor: '#1A1A1A' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="mb-2 text-center text-lg font-semibold"
              style={{ color: '#FAFAFA' }}
            >
              Удалить доску?
            </p>
            <p
              className="mb-6 text-center text-sm"
              style={{ color: '#8B8B8B' }}
            >
              Все задачи и данные будут удалены без возможности восстановления.
            </p>
            <div className="flex flex-col gap-3">
              <Button
                variant="solid"
                onClick={handleDeleteWorkspace}
                disabled={deletingWorkspace}
                fill="#EF4444"
                textColor="#FAFAFA"
              >
                {deletingWorkspace ? 'Удаление...' : 'Удалить доску'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingWorkspace}
                style={{ borderColor: '#333', color: '#8B8B8B' }}
              >
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline CTA */}
      <div
        className="px-4 pt-2 lg:hidden"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex flex-col gap-3">
          <Button
            variant="solid"
            disabled={!canSubmit || saving || uploading}
            onClick={handleSubmit}
          >
            {saving ? 'Сохранение...' : uploading ? 'Загрузка документов...' : 'Сохранить'}
          </Button>
          {isOwner && (
            <Button
              variant="solid"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={saving || uploading || deletingWorkspace}
              fill="#EF4444"
              textColor="#FAFAFA"
            >
              Удалить доску
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function labelDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}