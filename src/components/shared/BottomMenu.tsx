'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

export function BottomMenu() {
  const pathname = usePathname();

  return (
    <nav
      className="
        fixed inset-x-0 bottom-0 z-50 mx-auto w-full
        pb-[env(safe-area-inset-bottom)]
      "
      aria-label="Основная навигация"
      role="navigation"
    >
      <div
        className="
          relative flex items-center justify-center
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
          gap: 'var(--spacing-bottom-menu-gap)',
        }}
      >
        {/* Left items */}
        <NavButton item={MENU_ITEMS[0]} currentPath={pathname} />
        <NavButton item={MENU_ITEMS[1]} currentPath={pathname} />

        {/* Center "create" button — 80×54px, SVG 2x (80×80) centered, box-shadow on Link (clipped to Link bounds) */}
        <Link
          href="/board/create"
          className="
            flex items-center justify-center
            relative shrink-0 overflow-hidden
            transition-transform duration-150
            hover:opacity-90 active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          "
          style={{
            width: 'var(--size-main-btn-width)',
            height: 'var(--size-main-btn-height)',
            top: 'calc(var(--spacing-bottom-menu-padding) * -1)',
            borderRadius: '9999px',
            boxShadow: `
              inset -1px -1px 4px 0px rgba(230, 199, 33, 0.2),
              inset 1px 1px 4px 0px rgba(46, 169, 140, 0.2),
              inset 0px 1px 10px 0px rgba(255, 255, 255, 0.05),
              inset 0px 1px 1px 0px rgba(255, 255, 255, 0.1)
            `,
          }}
          aria-label="Создать новую задачу"
          role="button"
        >
          {/* Create button SVG — 2x size (80×80), centered, no box-shadow (on parent Link) */}
          <svg
            viewBox="0 0 143 135"
            xmlns="http://www.w3.org/2000/svg"
            className="relative z-10"
            style={{
              width: 'calc(var(--size-main-btn-width) * 2)',
              height: 'calc(var(--size-main-btn-width) * 2)',
            }}
          >
            <defs>
              <linearGradient id="create-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e6c721"/>
                <stop offset="100%" stopColor="#2ea98c"/>
              </linearGradient>
            </defs>
            <path
              d="M 8.00 66.06 L 8.00 66.06 Q 8.00 63.00 5.28 59.26 L 2.72 55.74 Q 0.00 52.00 0.00 43.00 L 0.00 27.00 Q 0.00 18.00 1.36 14.94 L 2.64 12.06 Q 4.00 9.00 5.70 7.30 L 7.30 5.70 Q 9.00 4.00 11.72 2.64 L 14.28 1.36 Q 17.00 0.00 26.00 0.00 L 43.00 0.00 Q 52.00 0.00 55.74 2.72 L 59.26 5.28 Q 63.00 8.00 68.78 8.00 L 74.22 8.00 Q 80.00 8.00 83.74 5.28 L 87.26 2.72 Q 91.00 0.00 100.00 0.00 L 117.00 0.00 Q 126.00 0.00 128.72 1.36 L 131.28 2.64 Q 134.00 4.00 135.70 5.70 L 137.30 7.30 Q 139.00 9.00 140.36 12.06 L 141.64 14.94 Q 143.00 18.00 143.00 27.00 L 143.00 43.00 Q 143.00 52.00 140.28 55.74 L 137.72 59.26 Q 135.00 63.00 135.00 66.06 L 135.00 68.94 Q 135.00 72.00 137.72 75.74 L 140.28 79.26 Q 143.00 83.00 143.00 92.00 L 143.00 108.00 Q 143.00 117.00 141.64 120.06 L 140.36 122.94 Q 139.00 126.00 137.30 127.70 L 135.70 129.30 Q 134.00 131.00 131.28 132.36 L 128.72 133.64 Q 126.00 135.00 117.00 135.00 L 100.00 135.00 Q 91.00 135.00 87.26 132.28 L 83.74 129.72 Q 80.00 127.00 74.22 127.00 L 68.78 127.00 Q 63.00 127.00 59.26 129.72 L 55.74 132.28 Q 52.00 135.00 43.00 135.00 L 26.00 135.00 Q 17.00 135.00 14.28 133.64 L 11.72 132.36 Q 9.00 131.00 7.30 129.30 L 5.70 127.70 Q 4.00 126.00 2.64 122.94 L 1.36 120.06 Q 0.00 117.00 0.00 108.00 L 0.00 92.00 Q 0.00 83.00 2.72 79.26 L 5.28 75.74 Q 8.00 72.00 8.00 68.94 Z"
              fill="none"
              stroke="url(#create-gradient)"
              strokeWidth="2.5"
            />
            <line x1="71.5" y1="47" x2="71.5" y2="88" stroke="white" strokeWidth="6" strokeLinecap="round"/>
            <line x1="51" y1="67.5" x2="92" y2="67.5" stroke="white" strokeWidth="6" strokeLinecap="round"/>
          </svg>
        </Link>

        {/* Right items */}
        <NavButton item={MENU_ITEMS[2]} currentPath={pathname} />
        <NavButton item={MENU_ITEMS[3]} currentPath={pathname} />
      </div>
    </nav>
  );
}

/**
 * Individual nav button — icon + label, flex-1, centered.
 * Figma: column, padding 8px, gap 2px, height 54px, border-radius 9999px
 * Icon: 20×20px, Text: 8px Semi Bold, letterSpacing -0.0625em
 */
function NavButton({ item, currentPath }: { item: MenuItem; currentPath: string }) {
  const isActive = currentPath === item.href;
  const IconComponent = item.icon;

  return (
    <Link
      href={item.href}
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