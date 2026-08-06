'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  IconLayoutList,
  IconGridDots,
  IconCalendarWeek,
  IconSettings2,
} from '@tabler/icons-react';

/**
 * BottomMenu — Fixed bottom navigation bar.
 *
 * Figma specs (node 1:433):
 *   - Container: row, padding 5px, gap 4px, justify-content center, 358×88px
 *   - 4 menu items: column, padding 8px, gap 2px, height 54px, border-radius 9999px
 *     - Icon: 20×20px
 *     - Text: Inter Semi Bold 600, 8px, letterSpacing -0.0625em, color #8B8B8B
 *   - Center button: 80×54px, column, padding 8px, gap 2px
 *     - Icon: 40×40px
 *     - Glow frame: 72×72px, position absolute (4, -9)
 *     - Box shadow: inset amber/teal/white
 *   - Background: #0A0A0A, backdrop blur 30px
 *   - Top border: gradient amber → teal → transparent → teal → amber
 *
 * Design tokens from src/styles/tokens.css and src/app/globals.css
 */

type MenuItem = {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
};

const MENU_ITEMS: MenuItem[] = [
  {
    id: 'flowboard',
    label: 'Доска',
    href: '/flowboard',
    icon: IconLayoutList,
  },
  {
    id: 'kanban',
    label: 'Стол',
    href: '/boards',
    icon: IconGridDots,
  },
  {
    id: 'calendar',
    label: 'Календарь',
    href: '/calendar',
    icon: IconCalendarWeek,
  },
  {
    id: 'settings',
    label: 'Настройки',
    href: '/settings',
    icon: IconSettings2,
  },
];

export function BottomMenu({ onCenterClick }: { onCenterClick?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showNotice, setShowNotice] = useState(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const handleCenterClick = useCallback(() => {
    if (onCenterClick) {
      onCenterClick();
      return;
    }
    // Fallback: task creation not yet available on this page — show a notice
    setShowNotice(true);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setShowNotice(false), 2500);
  }, [onCenterClick]);

  // Toggle between flowboard and stream views when already on /flowboard
  const isOnFlowboard = pathname === '/flowboard';
  const isStreamView = searchParams.get('view') === 'stream';

  const handleFlowboardClick = useCallback(() => {
    if (!isOnFlowboard) {
      router.push('/flowboard');
      return;
    }
    // Already on flowboard — toggle between stream and flowboard views
    router.push(isStreamView ? '/flowboard' : '/flowboard?view=stream');
  }, [isOnFlowboard, isStreamView, router]);

  return (
    <nav
      className="
        fixed inset-x-0 bottom-0 z-50 mx-auto w-full
      "
      aria-label="Основная навигация"
      role="navigation"
    >
      <div
        className="
          relative flex items-start justify-center
          bg-primary-dark
          backdrop-blur-[var(--blur-bottom-menu)]
          before:absolute before:inset-x-0 before:top-0 before:h-px
          before:bg-gradient-to-r
          before:from-[var(--gradient-bottom-menu-start)]
          before:via-[var(--gradient-bottom-menu-mid-1)]
          before:via-[var(--gradient-bottom-menu-mid-2)]
          before:via-[var(--gradient-bottom-menu-mid-3)]
          before:to-[var(--gradient-bottom-menu-end)]
          before:opacity-60
          before:pointer-events-none
        "
        style={{
          minHeight: 'var(--size-bottom-menu-height)',
          padding: 'var(--spacing-bottom-menu-padding)',
          paddingBottom: 'calc(var(--spacing-bottom-menu-padding) + env(safe-area-inset-bottom))',
          gap: 'var(--spacing-bottom-menu-gap)',
        }}
      >
        {/* Left group — symmetric width, icons aligned with center plus */}
        <div
          className="flex flex-1 items-start justify-center gap-[var(--spacing-bottom-menu-gap)]"
          style={{
            paddingTop: 'var(--spacing-bottom-menu-padding)',
            marginRight: 'calc(var(--spacing-bottom-menu-gap) * 4)',
          }}
        >
          <NavButton item={MENU_ITEMS[0]} currentPath={pathname} onClick={handleFlowboardClick} />
          <NavButton item={MENU_ITEMS[1]} currentPath={pathname} />
        </div>

        {/* Center "create" button — notch bottom touches gradient line */}
        <button
          type="button"
          onClick={handleCenterClick}
          className="
            flex items-center justify-center
            relative shrink-0
            transition-transform duration-150
            hover:opacity-90 active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          "
          style={{
            width: 'var(--size-main-btn-width)',
            height: 'var(--size-main-btn-height)',
            top: '0',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
          aria-label="Создать новую задачу"
        >
          {/* Background shape — 160×160px, auto-clipped to 80×54px container */}
          <img
            src="/icons/central-button-shape.svg"
            alt=""
            className="relative z-10"
            style={{
              width: 'calc(var(--size-main-btn-width) * 2)',
              height: 'calc(var(--size-main-btn-width) * 2)',
              opacity: 1,
            }}
          />
          {/* Plus icon — centered, 40×40px */}
          <img
            src="/icons/plus.svg"
            alt=""
            className="absolute inset-0 m-auto z-20"
            style={{
              width: '40px',
              height: '40px',
            }}
          />
        </button>

        {/* Fallback notice — shown when task creation is not yet available on this page */}
        {showNotice && (
          <div
            className="fixed left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg text-sm"
            style={{
              bottom: 'calc(var(--size-bottom-menu-height) + 12px)',
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-line)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-sm)',
              whiteSpace: 'nowrap',
            }}
            role="status"
            aria-live="polite"
          >
            Создание задачи пока недоступно, подождите
          </div>
        )}

        {/* Right group — symmetric width, icons aligned with center plus */}
        <div
          className="flex flex-1 items-start justify-center gap-[var(--spacing-bottom-menu-gap)]"
          style={{
            paddingTop: 'var(--spacing-bottom-menu-padding)',
            marginLeft: 'calc(var(--spacing-bottom-menu-gap) * 4)',
          }}
        >
          <NavButton item={MENU_ITEMS[2]} currentPath={pathname} />
          <NavButton item={MENU_ITEMS[3]} currentPath={pathname} />
        </div>
      </div>
    </nav>
  );
}

/**
 * Individual nav button — icon + label, flex-1, centered.
 * Figma: column, padding 8px, gap 2px, height 54px, border-radius 9999px
 * Icon: 20×20px, Text: 8px Semi Bold, letterSpacing -0.0625em
 */
function NavButton({ item, currentPath, onClick }: { item: MenuItem; currentPath: string; onClick?: () => void }) {
  const isActive = currentPath === item.href;
  const IconComponent = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="
        flex flex-1 flex-col items-center justify-center
        rounded-full
        transition-colors duration-fast
        hover:opacity-80 active:opacity-60
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
      "
      style={{
        height: 'var(--size-main-btn-height)',
        padding: '8px',
        gap: '2px',
        color: isActive
          ? 'var(--color-bottom-menu-text-active)'
          : 'var(--color-bottom-menu-text-inactive)',
      }}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
    >
      <IconComponent
        size={20}
        stroke={isActive ? 2 : 1.5}
        style={{
          width: 'var(--size-bottom-menu-icon)',
          height: 'var(--size-bottom-menu-icon)',
          color: isActive ? 'var(--color-text-white)' : 'var(--color-text-muted)',
        }}
      />
      <span
        className={isActive ? 'font-semibold' : ''}
        style={{
          fontFamily: 'var(--font-family-display)',
          fontSize: 'var(--text-bottom-menu-label)',
          lineHeight: 'var(--text-bottom-menu-label-line)',
          fontWeight: 'var(--font-weight-semibold)',
          letterSpacing: '-0.0625em',
        }}
      >
        {item.label}
      </span>
    </Link>
  );
}