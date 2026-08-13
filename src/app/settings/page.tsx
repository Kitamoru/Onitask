'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  UserProfileCard,
  WorkspaceSettingsCard,
  OtherSettingsCard,
  CalendarSettingsCard,
} from '@/components/settings';

function SettingsContent() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace_id') ?? '';

  return <SettingsInner workspaceId={workspaceId} />;
}

interface SettingsInnerProps {
  workspaceId: string;
}

/**
 * Settings page — Figma node 65:14537 "settings".
 * Displays user profile, workspace settings, calendar integrations, and other preferences.
 *
 * Layout matches board/desk pages: main container with safe area padding.
 */
function SettingsInner({ workspaceId }: SettingsInnerProps) {
  const handleMcpClick = () => {
    // TODO: navigate to MCP integrations
    console.log('Navigate to MCP integrations');
  };

  const handlePlansClick = () => {
    // TODO: navigate to plans
    console.log('Navigate to plans');
  };

  const handleColleaguesClick = () => {
    // TODO: navigate to colleagues
    console.log('Navigate to colleagues');
  };

  const handleLanguageClick = () => {
    // TODO: open language picker
    console.log('Open language picker');
  };

  const handleSupportClick = () => {
    // TODO: open Telegram support chat
    console.log('Open Telegram support');
  };

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
      style={{
        paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
      }}
    >
      <div className="flex flex-col gap-6 px-4 pb-[64px] pt-6">
        {/* Personal section */}
        <UserProfileCard
          username="@kitamoru"
          planName="Solo"
          price="290₽/мес"
          statusLabel="💼 Работаю"
        />

        {/* Workspace settings section */}
        <WorkspaceSettingsCard
          onMcpClick={handleMcpClick}
          onPlansClick={handlePlansClick}
          onColleaguesClick={handleColleaguesClick}
        />

        {/* Calendar integrations section */}
        {workspaceId && (
          <CalendarSettingsCard workspaceId={workspaceId} />
        )}

        {/* Other section */}
        <OtherSettingsCard
          language="🇷🇺 Русский"
          onLanguageClick={handleLanguageClick}
          onSupportClick={handleSupportClick}
        />
      </div>
    </main>
  );
}

/**
 * Settings page with Suspense boundary for useSearchParams().
 */
export default function SettingsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center min-h-dvh">
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        </div>
      }
    >
      <SettingsContent />
    </React.Suspense>
  );
}
