'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getClient } from '@/lib/supabase/client';

/**
 * Settings page — Figma node 65:14537 "settings".
 *
 * Layout structure:
 * 1. personal — avatar (104×104), username @kitamoru, plan badge, status row
 * 2. workspace-settings — heading "Рабочее пространство" + button group (MCP, Plans, Colleagues)
 * 3. other — heading "Прочее" + rows (Language, Support)
 * 4. bottom-filler — 64px safe area
 */

// ─── Chevron Right Icon (inline SVG matching Figma 176:23190) ──────────────

function ChevronRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.5 15L12.5 10L7.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Telegram Brand Icon (inline SVG matching Figma 424:32061) ─────────────

function TelegramIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ─── Ref Background Shape (Figma EL-d8353599 / EL-6349d532) ─────────────────

function RefBgShape() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 358 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
    >
      <rect width="358" height="48" fill="url(#bg-gradient)" opacity="0.06" />
      <defs>
        <linearGradient
          id="bg-gradient"
          x1="0"
          y1="24"
          x2="358"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--color-text-muted)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--color-text-muted)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--color-text-muted)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Section Heading (Figma EL-bb582553 pattern) ────────────────────────────

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="rounded-full bg-accent-amber"
        style={{ width: '2px', height: '18px' }}
      />
      <span
        className="font-display font-medium"
        style={{
          fontSize: '14px',
          lineHeight: '18px',
          color: 'var(--tg-theme-text-color, var(--color-text-primary, #FAFAFA))',
        }}
      >
        {title}
      </span>
    </div>
  );
}

// ─── Gray Row Component — gray label left, white value right, chevron/telegram icon ──

interface GrayRowProps {
  label: string;
  value: string;
  trailingIcon?: 'chevron' | 'telegram';
  onClick?: () => void;
}

function GrayRow({ label, value, trailingIcon = 'chevron', onClick }: GrayRowProps) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-between px-3 py-3 rounded-[6px] w-full hover:bg-white/[0.03] active:bg-white/[0.06] transition-colors overflow-hidden group"
      style={{ minHeight: '48px' }}
    >
      <RefBgShape />
      <div className="relative z-10 flex items-center justify-between w-full">
        <span
          className="font-display font-medium"
          style={{
            fontSize: '16px',
            lineHeight: '20px',
            color: 'var(--tg-theme-section-header-text-color, var(--color-text-secondary, #808080))',
          }}
        >
          {label}
        </span>
        <span
          className="font-display font-medium flex items-center gap-1"
          style={{
            fontSize: '16px',
            lineHeight: '20px',
            color: 'var(--tg-theme-text-color, var(--color-text-primary, #FAFAFA))',
          }}
        >
          {value}
          {trailingIcon === 'chevron' ? (
            <ChevronRightIcon />
          ) : (
            <TelegramIcon />
          )}
        </span>
      </div>
    </button>
  );
}

// ─── Action Button (Figma button-group item pattern) ────────────────────────

interface ActionButtonProps {
  label: string;
  onClick?: () => void;
}

function ActionButton({ label, onClick }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-between px-3 py-3 w-full hover:bg-white/[0.03] active:bg-white/[0.06] transition-colors overflow-hidden group"
      style={{
        minHeight: '42px',
        borderRadius: '4px',
        borderWidth: '1px',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        clipPath: 'inset(0 round 8px)',
      }}
    >
      <RefBgShape />
      <span
        className="relative z-10 font-display font-medium"
        style={{
          fontSize: '14px',
          lineHeight: '18px',
          color: 'var(--tg-theme-text-color, var(--color-text-primary, #FAFAFA))',
        }}
      >
        {label}
      </span>
      <div
        className="relative z-10 text-text-muted group-hover:text-text-primary transition-colors"
        style={{ flexShrink: 0 }}
      >
        <ChevronRightIcon />
      </div>
    </button>
  );
}

// ─── Avatar Component (Figma instance "user-img" #33:5574) ─────────────────

function UserAvatar({ username, telegramPhotoUrl }: { username: string; telegramPhotoUrl?: string }) {
  const initial = username.replace('@', '').charAt(0).toUpperCase();

  return (
    <div
      className="overflow-hidden"
      style={{
        width: '104px',
        height: '104px',
        borderRadius: '4px',
      }}
    >
      {telegramPhotoUrl ? (
        <img
          src={telegramPhotoUrl}
          alt={username}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center text-white text-3xl font-medium"
          style={{ backgroundColor: 'var(--color-bg-secondary, #1A1A1A)' }}
        >
          {initial}
        </div>
      )}
    </div>
  );
}

// ─── Plan Badge (Figma instance "badge" #17:8819) ──────────────────────────

function PlanBadge() {
  return (
    <div
      className="inline-flex items-center px-2 py-1 rounded-[4px]"
      style={{
        backgroundColor: 'rgba(245, 158, 11, 0.2)',
        border: '1px solid #F59E0B',
      }}
    >
      <span
        className="font-display font-medium"
        style={{
          fontFamily: 'var(--font-family-display, system-ui, sans-serif)',
          fontSize: '12px',
          lineHeight: '14px',
          fontWeight: 500,
          color: '#FFFFFF',
        }}
      >
        free
      </span>
    </div>
  );
}

// ─── Main Settings Content ─────────────────────────────────────────────────

function SettingsContent() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace_id') ?? '';
  const router = useRouter();
  const supabase = getClient();

  const [username, setUsername] = useState('@kitamoru');
  const [telegramPhotoUrl, setTelegramPhotoUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const displayUsername = user.user_metadata?.username
            ? '@' + user.user_metadata.username
            : user.email?.split('@')[0] || '@kitamoru';
          setUsername(displayUsername);

          // Try to get Telegram photo if available
          if (user.user_metadata?.telegram_photo_url) {
            setTelegramPhotoUrl(user.user_metadata.telegram_photo_url);
          }
        }
      } catch (err) {
        console.error('Failed to load user:', err);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [supabase]);

  const handleMcpClick = () => {
    router.push('/settings/mcp');
  };

  const handlePlansClick = () => {
    console.log('Navigate to plans');
    // TODO: navigate to plans page
  };

  const handleColleaguesClick = () => {
    console.log('Navigate to colleagues');
    // TODO: navigate to colleagues page
  };

  const handleLanguageClick = () => {
    console.log('Open language picker');
    // TODO: open language picker
  };

  const handleSupportClick = () => {
    window.open('https://t.me/onitask_support', '_blank');
  };

  if (loading) {
    return (
      <div
        className="min-h-[var(--tg-viewport-stable-height,100dvh)] flex items-center justify-center"
        style={{
          background: 'var(--color-bg-primary-dark, #0A0A0A)',
          paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        }}
      >
        <p style={{ color: 'var(--color-text-muted, #8B8B8B)' }}>Загрузка...</p>
      </div>
    );
  }

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)]"
      style={{
        background: 'var(--color-bg-primary-dark, #0A0A0A)',
        paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        paddingBottom: 'calc(var(--size-bottom-menu-height, 96px) + 16px)',
      }}
    >
      <div className="flex flex-col gap-6 px-4 pb-[64px] pt-6">
        {/* ═══ PERSONAL SECTION ═══ */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Avatar */}
          <UserAvatar username={username} telegramPhotoUrl={telegramPhotoUrl} />

          {/* Username & Plan Badge */}
          <div className="flex items-center gap-2 w-full justify-center flex-wrap">
            <span
              className="font-display font-medium truncate"
              style={{
                fontSize: '20px',
                lineHeight: '24px',
                color: 'var(--color-bg-light, #FAFAFA)',
              }}
            >
              {username}
            </span>
            <PlanBadge />
          </div>

          {/* Status Row */}
          <GrayRow
            label="Статус"
            value="💼 Работаю"
            onClick={() => console.log('Toggle status')}
          />
        </div>

        {/* ═══ WORKSPACE SETTINGS SECTION ═══ */}
        <div className="flex flex-col gap-3 w-full">
          <SectionHeading title="Рабочее пространство" />
          <div className="flex flex-col gap-2">
            <ActionButton label="Интеграции MCP" onClick={handleMcpClick} />
            <ActionButton label="Тарифы" onClick={handlePlansClick} />
            <ActionButton label="Мои коллеги" onClick={handleColleaguesClick} />
          </div>
        </div>

        {/* ═══ OTHER SECTION ═══ */}
        <div className="flex flex-col gap-3 w-full">
          <SectionHeading title="Прочее" />
          <GrayRow
            label="Язык"
            value="🇷🇺 Русский"
            onClick={handleLanguageClick}
          />
          <GrayRow
            label="Техподдержка"
            value="Написать"
            trailingIcon="telegram"
            onClick={handleSupportClick}
          />
        </div>

        {/* ═══ BOTTOM FILLER (safe area) ═══ */}
        <div
          className="w-full"
          style={{ height: '64px', background: 'var(--color-bg-primary-dark, #0A0A0A)' }}
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
        <div
          className="flex items-center justify-center min-h-dvh"
          style={{ background: 'var(--color-bg-primary-dark, #0A0A0A)' }}
        >
          <p style={{ color: 'var(--color-text-muted, #8B8B8B)' }}>Загрузка...</p>
        </div>
      }
    >
      <SettingsContent />
    </React.Suspense>
  );
}
