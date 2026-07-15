'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoardForm, type BoardFormData } from '@/components/board';

/**
 * Create Board page — renders the "desk / create" design from Figma.
 * 
 * Route: /board/create
 * Matches Figma node: 1:913 (desk / create)
 * 
 * Flow:
 * 1. User fills BoardForm
 * 2. Submit → POST /api/workspaces with form data + Telegram init_data
 * 3. On success → redirect to /board/[slug]
 * 4. On error → show error message in form
 */

export default function CreateBoardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();

  /**
   * Get Telegram init_data for authentication.
   * In TWA environment, this comes from Telegram.WebApp.initData.
   * For development/testing, we use a mock flag.
   */
  function getTelegramInitData(): string {
    // Check if running in Telegram Web App
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
      return (window as any).Telegram.WebApp.initData;
    }
    // Development mode: return empty string (will need auth fix for local dev)
    return '';
  }

  const handleSubmit = async (data: BoardFormData) => {
    setLoading(true);
    setError(undefined);

    try {
      // Validate slug format (4-5 chars as per BoardForm validation)
      if (data.slug.length > 0 && (data.slug.length < 4 || data.slug.length > 5)) {
        setError('Идентификатор доски должен быть 4 или 5 символов');
        setLoading(false);
        return;
      }

      // Build request payload
      const payload: Record<string, unknown> = {
        init_data: getTelegramInitData(),
        name: data.name,
        slug: data.slug.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
        
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
        throw new Error(errData.error || errData.message || res.statusText || 'Failed to create board');
      }

      const result = await res.json();
      
      // Redirect to the new board
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
      className="min-h-screen w-full"
      style={{ backgroundColor: '#0A0A0A' }}
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