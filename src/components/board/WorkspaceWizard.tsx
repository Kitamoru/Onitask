'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoardForm, type BoardFormData } from './BoardForm';
import { generateTaskPrefix } from '../../../lib/workspace';

/**
 * WorkspaceWizard — Initial screen for creating a new workspace.
 * 
 * This component wraps BoardForm and adds:
 * - Auto-generation of task_prefix from slug
 * - Simplified flow (no documents, links, signals by default)
 * - Redirect to Flow Board after successful creation
 * 
 * Route: /wizard (used when is_new_user === true from /api/init)
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
 */

export interface WorkspaceWizardProps {
  /** Called when workspace creation succeeds */
  onSuccess?: (slug: string) => void;
}

export function WorkspaceWizard({ onSuccess }: WorkspaceWizardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();

  /**
   * Get Telegram init_data for authentication.
   */
  function getTelegramInitData(): string {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
      return (window as any).Telegram.WebApp.initData;
    }
    return '';
  }

  const handleSubmit = async (data: BoardFormData) => {
    setLoading(true);
    setError(undefined);

    try {
      // Validate slug format (4-5 chars)
      if (data.slug.length > 0 && (data.slug.length < 4 || data.slug.length > 5)) {
        setError('Идентификатор доски должен быть 4 или 5 символов');
        setLoading(false);
        return;
      }

      // Generate task_prefix from slug
      const prefixResult = generateTaskPrefix(data.slug);

      // Build request payload
      const payload: Record<string, unknown> = {
        init_data: getTelegramInitData(),
        name: data.name,
        slug: data.slug.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        task_prefix: prefixResult.prefix,

        // Story points config
        story_points_config: data.storyPoints.enabled
          ? { enabled: true, values: data.storyPoints.values }
          : { enabled: false },

        // Cognitive budget
        enable_cognitive_budget: data.cognitiveWeight.enabled,

        // Context (only if non-empty)
        workspace_context: data.context.trim() || undefined,

        // External links (only if enabled and has valid links)
        external_links: data.externalLinks.length > 0
          ? data.externalLinks.filter(link => link.name.trim() || link.url.trim())
              .map(link => ({
                name: link.name.trim().slice(0, 100),
                url: link.url.trim().slice(0, 2048),
              }))
          : undefined,

        // Deadline signals (only if enabled)
        deadline_signals: data.signals.enabled && data.signals.values.length > 0
          ? data.signals.values.map(s => ({
              value: s.value,
              label: s.label,
            }))
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

      // Call onSuccess callback if provided
      onSuccess?.(result.workspace.slug);

      // Redirect to the new workspace board
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
      className="min-h-screen w-full bg-primary-dark"
      style={{ backgroundColor: 'var(--color-bg-primary-dark)' }}
    >
      <div className="mx-auto">
        <BoardForm
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
}

export default WorkspaceWizard;