'use client';

import {
  UserProfileCard,
  WorkspaceSettingsCard,
  OtherSettingsCard,
} from '@/components/settings';

/**
 * Settings page — Figma node 65:14537 "settings".
 * Displays user profile, workspace settings, and other preferences.
 *
 * Layout matches board/desk pages: main container with safe area padding.
 */
export default function SettingsPage() {
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