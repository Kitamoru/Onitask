'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BoardForm, type BoardFormData } from '@/components/board';
import { useAuth } from '@/hooks/useAuth';

/**
 * Create Board page — renders the "desk / create" design from Figma.
 * 
 * Route: /board/create
 * Matches Figma node: 1:913 (desk / create)
 * 
 * Flow:
 * 1. User arrives here either from root redirect (new user) or manually
 * 2. If user already has a workspace (not new), redirect to /flowboard
 * 3. User fills BoardForm
 * 4. Submit → POST /api/workspaces with form data + Telegram init_data
 * 5. On success → redirect to /boards
 */

export default function CreateBoardPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const router = useRouter();
  const { isLoading: authLoading, error: authError, data: authData } = useAuth();

  // Prevent infinite redirect loops using a ref
  const hasRedirectedRef = useRef(false);

  // Redirect existing users back to flowboard
  useEffect(() => {
    if (authLoading) return;
    if (authError) return;
    // Prevent repeated redirects
    if (hasRedirectedRef.current) return;
    // If user is not new (already has account), redirect to flowboard
    if (authData?.is_new_user === false) {
      hasRedirectedRef.current = true;
      router.replace('/flowboard');
    }
  }, [authLoading, authError, authData?.is_new_user, router]);

  /**
   * Get Telegram init_data for authentication.
   * In TWA environment, this comes from Telegram.WebApp.initData.
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
      
      // Redirect back to Boards overview (Стол) — user can navigate to the new board from there
      router.push('/boards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Auth loading state
  if (authLoading) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <p style={{ color: '#8B8B8B' }}>Загрузка...</p>
      </div>
    );
  }

  // Auth error state
  if (authError) {
    return (
      <div
        className="flex items-center justify-center h-full min-h-dvh p-4"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <div className="text-center max-w-sm">
          <p style={{ color: '#EF4444', fontFamily: 'system-ui' }}>
            Ошибка авторизации. Откройте приложение через Telegram Web App.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full min-h-dvh w-full"
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