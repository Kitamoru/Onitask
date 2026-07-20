'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreateDeskForm, type CreateDeskFormValue } from '@/components/desk-create';
import { generateTaskPrefix } from '../../../lib/workspace';

/**
 * WorkspaceWizard — Initial screen for creating a new workspace.
 * 
 * This component wraps CreateDeskForm and adds:
 * - Auto-generation of task_prefix from slug
 * - Simplified navigation after successful creation
 * 
 * Route: /wizard (used when is_new_user === true from /api/init)
 */

export interface WorkspaceWizardProps {
  /** Called when workspace creation succeeds */
  onSuccess?: (slug: string) => void;
}

export function WorkspaceWizard({ onSuccess }: WorkspaceWizardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();

  function getTelegramInitData(): string {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
      return (window as any).Telegram.WebApp.initData;
    }
    return '';
  }

  function labelDays(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
    return 'дней';
  }

  const handleSubmit = async (value: CreateDeskFormValue) => {
    setLoading(true);
    setError(undefined);

    try {
      if (value.slug.length > 0 && (value.slug.length < 4 || value.slug.length > 5)) {
        setError('Идентификатор доски должен быть 4 или 5 символов');
        setLoading(false);
        return;
      }

      // Generate task_prefix from slug
      const prefixResult = generateTaskPrefix(value.slug);
      const spValues: [number, number, number, number, number] = [1, 3, 5, 7, 13];

      const payload: Record<string, unknown> = {
        init_data: getTelegramInitData(),
        name: value.name,
        slug: value.slug.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        task_prefix: prefixResult.prefix,

        story_points_config: value.spCostEnabled
          ? { enabled: true, values: spValues }
          : { enabled: false },

        enable_cognitive_budget: value.cognitiveWeightEnabled,

        workspace_context: value.context.trim() || undefined,

        external_links: value.linksEnabled && value.links.length > 0
          ? value.links.map(link => ({
              name: link.title.trim().slice(0, 100),
              url: link.url.trim().slice(0, 2048),
            }))
          : undefined,

        deadline_signals: value.trafficLightEnabled
          ? [
              { value: value.warningDays, label: `${value.warningDays} ${labelDays(value.warningDays)}` },
              { value: value.urgentDays, label: `${value.urgentDays} ${labelDays(value.urgentDays)}` },
            ]
          : undefined,
      };

      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || errData.message || res.statusText || 'Failed to create workspace');
      }

      const result = await res.json();

      onSuccess?.(result.workspace.slug);

      router.push(`/board/${result.workspace.slug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="h-full min-h-dvh w-full"
      style={{ backgroundColor: '#0A0A0A' }}
    >
      {error && (
        <div className="px-4 pt-4">
          <div className="rounded-[10px] bg-accent-amber/10 px-4 py-2 text-sm text-[#F59E0B]" role="alert">
            {error}
          </div>
        </div>
      )}
      <CreateDeskForm
        onSubmit={handleSubmit}
        onAddColleague={() => console.log('add colleague')}
      />
    </div>
  );
}

export default WorkspaceWizard;