"use client";

import { useRef, useState } from "react";
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
import { ColleagueSelectSheet, type ColleagueItem } from "@/components/desk-create/ColleagueSelectSheet";

import {
  defaultStoryPointHours,
  type StoryPointReferenceTasks,
  type StoryPointDoneTask,
} from "@/lib/storyPoints";

export interface BoardViewEditInitialData {
  name: string;
  slug: string;
  spCostEnabled: boolean;
  spHours?: Record<string, string>;
  spReferenceTasks?: StoryPointReferenceTasks;
  spSprintEnabled: boolean;
  cognitiveWeightEnabled: boolean;
  context: string;
  documentsEnabled: boolean;
  linksEnabled: boolean;
  links: ExternalLink[];
  trafficLightEnabled: boolean;
  warningDays: number;
  urgentDays: number;
}

export interface BoardViewEditProps {
  workspaceId: string;
  /** Может ли текущий пользователь редактировать доску (owner). */
  canEdit: boolean;
  /** Начальный режим: из ?edit=1 или устаревшего роута /edit. Для canEdit=false всегда view. */
  initialMode?: "view" | "edit";
  initialData: BoardViewEditInitialData;
  serverDocuments?: ServerDocument[];
  doneTasks?: StoryPointDoneTask[];
  /** Коллеги для выбора в режиме edit (active + deleted этой доски). */
  availableColleagues?: ColleagueItem[];
  /** Кол-во активных участников (показывается в view-режиме). */
  memberCount?: number;
  /** Уведомляет страницу о смене режима (для скрытия «Назад» и т.п.). */
  onModeChange?: (mode: "view" | "edit") => void;
}

export function BoardViewEdit({
  workspaceId,
  canEdit,
  initialMode = "view",
  initialData,
  serverDocuments = [],
  doneTasks = [],
  availableColleagues = [],
  memberCount = 0,
  onModeChange,
}: BoardViewEditProps) {
  const router = useRouter();

  // Режим — локальное состояние этой страницы (вход в edit не навигирует).
  // Не-овнер не получает edit-режим даже через ?edit=1 / устаревший /edit.
  const [mode, setMode] = useState<"view" | "edit">(canEdit ? initialMode : "view");
  const isView = mode === "view";

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
  const [spHours, setSpHours] = useState<Record<string, string>>(() => ({
    ...defaultStoryPointHours(),
    ...(initialData.spHours ?? {}),
  }));
  const [spReferenceTasks, setSpReferenceTasks] = useState<StoryPointReferenceTasks>(() =>
    Object.fromEntries(
      Object.entries(initialData.spReferenceTasks ?? {}).filter(([, reference]) =>
        doneTasks.some((task) => task.id === reference.task_id),
      ),
    ),
  );
  const [spSprintEnabled, setSpSprintEnabled] = useState(initialData.spSprintEnabled ?? false);
  const [cognitiveWeightEnabled, setCognitiveWeightEnabled] = useState(initialData.cognitiveWeightEnabled);
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

  // If the user re-enables the feature on an existing board, keep custom
  // values but fill only missing ranges with the standard defaults.
  const handleSpEnabledChange = (value: boolean) => {
    setSpCostEnabled(value);
    if (value) setSpHours((prev) => ({ ...defaultStoryPointHours(), ...prev }));
    else setSpReferenceTasks({});
  };

  // Coworking state
  const [selectedColleagues, setSelectedColleagues] = useState<Set<string>>(new Set());
  const [colleagueSheetOpen, setColleagueSheetOpen] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);

  const canSubmit = name.trim().length > 0;

  function getTelegramInitData(): string {
    if (typeof window !== "undefined") {
      return (window as any).Telegram?.WebApp?.initData || "";
    }
    return "";
  }

  /** Вход в редактирование — мгновенное переключение, без навигации/перезагрузки/скролла. */
  const enterEdit = () => {
    if (!canEdit) return;
    setError(null);
    setMode("edit");
    onModeChange?.("edit");
  };

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

      // Signal boards page to skip TTL and reload immediately
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('boards-needs-refresh', Date.now().toString());
      }
      // Success - navigate to boards list
      router.push('/boards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Не удалось удалить доску: ${message}`);
      console.error('Failed to delete workspace:', message);
      // Сброс только при ошибке: на успехе кнопка остаётся задизейбленной
      // до unmount при переходе на /boards.
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
            : [],
          story_points_config: {
            enabled: spCostEnabled,
            sprint_enabled: spSprintEnabled,
            values: [1, 2, 3, 5, 8],
            hours_per_sp: spHours,
            reference_tasks: spCostEnabled ? spReferenceTasks : {},
          },
          doc_kb_enabled: documentsEnabled,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to update workspace');
      }

      // After workspace update succeeds, add any staged colleagues
      if (selectedColleagues.size > 0) {
        setAddingMembers(true);
        try {
          const memberRes = await fetch(`/api/workspaces/${workspaceId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              init_data: initData,
              source_ids: Array.from(selectedColleagues),
            }),
          });

          if (!memberRes.ok) {
            const memberErr = await memberRes.json().catch(() => ({}));
            console.error('Failed to add members:', memberErr);
            // Don't throw — workspace settings are already saved
            // Show error but allow navigation
          }
        } catch (err) {
          console.error('Add members error:', err);
        } finally {
          setAddingMembers(false);
        }
      }

      // Success — navigate to boards list (как было до объединения).
      // /boards при следующем входе форсит refresh через boards-needs-refresh.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('boards-needs-refresh', Date.now().toString());
      }
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
      setSpHours(initialData.spHours ?? defaultStoryPointHours());
      setSpReferenceTasks(initialData.spReferenceTasks ?? {});
      setCognitiveWeightEnabled(originalValuesRef.current.cognitiveWeightEnabled);
      setDocumentsEnabled(originalValuesRef.current.documentsEnabled);
      setTrafficLightEnabled(originalValuesRef.current.trafficLightEnabled);
      setWarningDays(originalValuesRef.current.warningDays);
      setUrgentDays(originalValuesRef.current.urgentDays);

      setError(`Не удалось сохранить: ${message}`);
      console.error('Failed to update workspace:', message);
      // Сброс интерактивности только при ошибке: на успехе кнопка остаётся
      // в состоянии «Сохранение...» до unmount при переходе на /boards.
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Scrollable body — один canvas секций, режим включает/выключает disabled (как TaskViewEdit) */}
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
              disabled={isView}
            />
            <StoryPointCostCard
              enabled={spCostEnabled}
              onEnabledChange={handleSpEnabledChange}
              hoursBySp={spHours}
              referenceTasks={spReferenceTasks}
              doneTasks={doneTasks}
              onReferenceTaskChange={(sp, task) => setSpReferenceTasks((prev) => {
                const next = { ...prev };
                if (task) next[String(sp)] = task;
                else delete next[String(sp)];
                return next;
              })}
              onHoursChange={(sp, value) =>
                setSpHours((prev) => ({ ...prev, [String(sp)]: value }))
              }
              disabled={isView}
            />
            <CognitiveWeightCard
              enabled={cognitiveWeightEnabled}
              onEnabledChange={setCognitiveWeightEnabled}
              disabled={isView}
            />
          </div>
        </section>

        <CoworkingSection
          availableCount={isView ? memberCount : availableColleagues.length}
          selectedColleagues={
            isView
              ? []
              : Array.from(selectedColleagues).map(
                  (sid) => availableColleagues.find((c) => c.source_id === sid)!
                )
          }
          onOpenSelect={() => setColleagueSheetOpen(true)}
          disabled={isView}
          readOnly={isView}
        />

        <ContextSection value={context} onChange={setContext} disabled={isView} />

        <section>
          <SectionHeader title="Дополнительные материалы" />
          <div className="flex flex-col gap-4">
            <DocumentsCard
              enabled={documentsEnabled}
              onEnabledChange={setDocumentsEnabled}
              files={isView ? [] : localFiles}
              onFilesChange={setLocalFiles}
              serverDocuments={docs}
              onDeleteServerDocument={handleDeleteDocument}
              uploading={uploading}
              deletingId={deletingId}
              disabled={isView}
              readOnly={isView}
            />
            <ExternalLinksCard
              enabled={linksEnabled}
              onEnabledChange={setLinksEnabled}
              links={links}
              onLinksChange={setLinks}
              disabled={isView}
              readOnly={isView}
            />
          </div>
        </section>

        <section>
          <SectionHeader title="Модификации" />
          <TrafficLightCard
            enabled={trafficLightEnabled}
            onEnabledChange={setTrafficLightEnabled}
            warningDays={warningDays}
            onWarningDaysChange={setWarningDays}
            urgentDays={urgentDays}
            onUrgentDaysChange={setUrgentDays}
            disabled={isView}
          />
        </section>
      </div>

      {/* Delete confirmation modal — только owner (как в EditDeskForm) */}
      {showDeleteConfirm && canEdit && (
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

      {/* Footer CTA — view: «Редактировать» (только owner); edit: Сохранить / Удалить */}
      <div
        className="px-4 pt-4 lg:hidden"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {isView ? (
          canEdit && (
            <Button
              variant="solid"
              onClick={enterEdit}
              className="w-full"
            >
              Редактировать
            </Button>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              disabled={!canSubmit || saving || uploading}
              onClick={handleSubmit}
            >
              {saving ? 'Сохранение...' : uploading ? 'Загрузка документов...' : 'Сохранить'}
            </Button>
            {canEdit && (
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
        )}
      </div>

      {/* Colleague selection sheet */}
      <ColleagueSelectSheet
        open={colleagueSheetOpen}
        onClose={() => setColleagueSheetOpen(false)}
        colleagues={availableColleagues}
        selectedIds={selectedColleagues}
        onToggle={(sourceId) => {
          setSelectedColleagues((prev) => {
            const next = new Set(prev);
            if (next.has(sourceId)) {
              next.delete(sourceId);
            } else {
              next.add(sourceId);
            }
            return next;
          });
        }}
        onConfirm={() => setColleagueSheetOpen(false)}
        title="Добавить коллег"
      />
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