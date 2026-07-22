'use client';

import React, { useState } from 'react';
import { CreateDeskForm, type CreateDeskFormValue } from '@/components/desk-create';
import { useData } from '@/contexts/DataContext';
import { useAuth } from '@/hooks/useAuth';

interface OnboardingModalProps {
  /** Callback when board is created successfully */
  onSuccess: () => void;
  /** Callback when modal is closed (optional) */
  onClose?: () => void;
}

/**
 * OnboardingModal — модальное окно для создания первой доски.
 * Показывается новым пользователям при первом входе.
 * Uses the pixel‑perfect CreateDeskForm.
 */
export function OnboardingModal({ onSuccess, onClose }: OnboardingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { loadBoardsData } = useData();
  const { refresh } = useAuth();

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

      const spValues: [number, number, number, number, number] = [1, 3, 5, 7, 13];

      const payload: Record<string, unknown> = {
        init_data: getTelegramInitData(),
        name: value.name,
        slug: value.slug.toLowerCase().replace(/[^a-z0-9_-]/g, ''),

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
        throw new Error(errData.error || errData.message || res.statusText || 'Failed to create board');
      }

      await refresh();
      await loadBoardsData();
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
        className="w-full max-w-form xs:max-w-md sm:max-w-md max-h-[90vh] overflow-y-auto rounded-lg"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        {error && (
        <div className="px-4 xs:px-5 sm:px-6 pt-4">
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
    </div>
  );
}
