'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconLayoutList,
  IconGridDots,
  IconCalendarWeek,
  IconSettings2,
  IconPlus,
} from '@tabler/icons-react';

/**
 * BottomMenu — Fixed bottom navigation bar matching Figma design (node 1:433).
 *
 * Design specs from Figma:
 *   - Container: row layout, 5px padding, 4px gap, background #0A0A0A
 *   - Top border: gradient (amber → teal → transparent → teal → amber)
 *   - Backdrop blur: 30px
 *   - 5 menu items: Доска, Стол, [+], Календарь, Настройки
 *   - Each item: 20×20 icon + 8px label below, color #8B8B8B (inactive)
 *   - Center button: 40×40 icon with glow effects, 80×54 container
 *   - All tokens from src/styles/tokens.css (no hex literals)
 *
 * Responsive behavior:
 *   - Mobile (< 640px): compact icons only on smallest screens, labels visible
 *   - Tablet+ (≥ 768px): increased spacing, larger touch targets
 *   - Desktop (≥ 1024px): max-width constraint, centered menu
 */

type MenuItem = {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  isMain?: boolean;
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
    id: 'main',
    label: '',
    href: '/board/create',
    icon: IconPlus,
    isMain: true,
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
        fixed bottom-0 left-0 right-0 z-50
        flex flex-row items-center justify-center
        bg-primary-dark
        transition-colors duration-fast
        xs:px-1 sm:px-2 md:px-4
        /* Safe area inset for notched devices */
        pb-safe-bottom
      "
      style={{
        height: 'var(--size-bottom-menu-height)',
        paddingTop: 'var(--spacing-bottom-menu-padding)',
        paddingBottom: 'max(var(--spacing-bottom-menu-padding), env(safe-area-inset-bottom))',
        paddingLeft: 'max(var(--spacing-bottom-menu-padding), env(safe-area-inset-left))',
        paddingRight: 'max(var(--spacing-bottom-menu-padding), env(safe-area-inset-right))',
        gap: 'var(--spacing-bottom-menu-gap)',
        borderTop: `1px solid transparent`,
        borderImage: `linear-gradient(90deg, 
          var(--gradient-bottom-menu-start) 0%, 
          var(--gradient-bottom-menu-mid-1) 40%, 
          var(--gradient-bottom-menu-mid-2) 41%, 
          var(--gradient-bottom-menu-mid-2) 59%, 
          var(--gradient-bottom-menu-mid-3) 60%, 
          var(--gradient-bottom-menu-end) 100%
        ) 1`,
        backdropFilter: 'blur(var(--blur-bottom-menu))',
      }}
      aria-label="Основная навигация"
      role="navigation"
    >
      {/* Inner gradient border overlay */}
      <div
        className="
          pointer-events-none absolute inset-x-0 top-0
          h-px
          bg-gradient-to-r
          from-[var(--gradient-bottom-menu-start)] via-[var(--gradient-bottom-menu-mid-1)] 
          via-[var(--gradient-bottom-menu-mid-2)] via-[var(--gradient-bottom-menu-mid-3)] 
          to-[var(--gradient-bottom-menu-end)]
          opacity-60
        "
        aria-hidden="true"
      />

      <div className="flex flex-row items-center justify-center gap-1 sm:gap-2 w-full max-w-[358px] sm:max-w-full">
        {MENU_ITEMS.map((item) => (
          <BottomMenuItem key={item.id} item={item} currentPath={pathname} />
        ))}
      </div>
    </nav>
  );
}

/**
 * Individual menu item component.
 * Handles active state, main button styling, and responsive sizing.
 */
function BottomMenuItem({ item, currentPath }: { item: MenuItem; currentPath: string }) {
  /**
   * Active state logic:
   * - /boards → only "Стол" (kanban) is active
   * - /flowboard → only "Доска" (flowboard) is active
   * - /board/create → only main (+) is active
   * - /calendar → only "Календарь" is active
   * - /settings → only "Настройки" is active
   */
  let isActive = false;

  if (item.isMain) {
    // Main button active for /board/* but NOT /boards and NOT /calendar
    isActive = currentPath !== '/boards' && currentPath !== '/calendar' && currentPath?.startsWith('/board') === true;
  } else if (currentPath === item.href) {
    // Exact match — but if multiple items share this href, only the first one wins
    const firstMatchingItem = MENU_ITEMS.find((m) => m.href === item.href);
    isActive = firstMatchingItem?.id === item.id;
  }
  const IconComponent = item.icon;

  if (item.isMain) {
    return (
      <Link
        href={item.href}
        className="
          flex flex-col items-center justify-center
          relative overflow-hidden
          transition-all duration-fast
          hover:opacity-90 active:opacity-70
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
          shrink-0
        "
        style={{
          width: 'var(--size-main-btn-width)',
          height: 'var(--size-main-btn-height)',
          boxShadow: `
            var(--shadow-main-btn-inner-dark),
            var(--shadow-main-btn-inner-teal),
            var(--shadow-main-btn-inner-white-1),
            var(--shadow-main-btn-inner-white-2)
          `,
        }}
        aria-label={`Создать новую задачу`}
        role="button"
      >
        {/* Glow overlay circle (Figma absolute icon at x:4, y:-9, 72×72) */}
        <div
          className="
            absolute inset-0 m-auto
            rounded-full
            bg-gradient-to-br
            from-[var(--gradient-bottom-menu-start)]/30
            to-[var(--gradient-bottom-menu-mid-1)]/20
            blur-sm
          "
          style={{
            width: 'clamp(2.75rem, 16vw, 4.5rem)', /* 44px–72px */
            height: 'clamp(2.75rem, 16vw, 4.5rem)',
            top: 'calc(var(--spacing-2) * -1)',
          }}
          aria-hidden="true"
        />
        <IconComponent
          size={48}
          stroke={1.5}
          style={{ color: 'var(--color-text-white)' }}
          className="relative z-10"
        />
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      className={`
        flex flex-col items-center justify-center gap-0.5
        rounded-full
        transition-all duration-fast
        hover:bg-surface/20 active:bg-surface/40
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
        px-1.5 py-1
        sm:px-2 sm:py-1.5
      `}
      style={{
        color: isActive
          ? 'var(--color-bottom-menu-text-active)'
          : 'var(--color-bottom-menu-text-inactive)',
      }}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
    >
      <IconComponent
        size={24}
        stroke={isActive ? 2 : 1.5}
        style={{ color: isActive ? 'var(--color-text-white)' : 'var(--color-text-muted)' }}
      />
      {item.label && (
        <span
          className="
            hidden font-semibold tracking-tighter
            sm:inline-block
            md:text-xs
          "
          style={{
            fontFamily: 'var(--font-family-display)',
            fontSize: 'var(--text-bottom-menu-label)',
            lineHeight: 'var(--text-bottom-menu-label-line)',
            fontWeight: 'var(--font-weight-semibold)',
            letterSpacing: 'var(--letter-spacing-tighter)',
          }}
        >
          {item.label}
        </span>
      )}
    </Link>
  );
}