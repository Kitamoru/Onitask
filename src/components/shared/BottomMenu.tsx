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
          <NavButton item={MENU_ITEMS[0]} currentPath={pathname} />
          <NavButton item={MENU_ITEMS[1]} currentPath={pathname} />
        </div>

        {/* Center "create" button — notch positioned to overlap gradient strip */}
        <Link
          href="/board/create"
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
            marginTop: '-18px',
          }}
          aria-label="Создать новую задачу"
          role="button"
        >
          {/* Background shape — fills entire button container */}
          <img
            src="/icons/central-button-shape.svg"
            alt=""
            className="absolute inset-0 z-10 w-full h-full"
            style={{ objectFit: 'contain' }}
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
        </Link>

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