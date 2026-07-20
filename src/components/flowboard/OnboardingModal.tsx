'use client';

import React, { useState } from 'react';
import { BoardForm, type BoardFormData } from '@/components/board';

interface OnboardingModalProps {
  /** Callback when board is created successfully */
  onSuccess: () => void;
  /** Callback when modal is closed (optional) */
  onClose?: () => void;
}

/**
 * OnboardingModal — модальное окно для создания первой доски.
 * Показывается новым пользователям при первом входе.
 */
export function OnboardingModal({ onSuccess, onClose }: OnboardingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

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

      // Success - close modal and refresh parent
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(10, 10, 10, 0.95)' }}
      aria-modal="true"
      role="dialog"
      aria-label="Создание первой доски"
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <BoardForm 
          onSubmit={handleSubmit} 
          loading={loading} 
          error={error} 
        />
      </div>
    </div>
  );
}