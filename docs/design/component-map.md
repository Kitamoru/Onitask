тзщ# Component Map — Onitask Design System

## Overview
This document maps Figma components to their code implementations in the Onitask project.
All components use design tokens from `src/styles/tokens.css` (no hardcoded hex values).

---

## Component Registry

| Figma Node | Component Name | Code Path | Status | Notes |
|------------|----------------|-----------|--------|-------|
| 1:433 | `BottomMenu` | `src/components/shared/BottomMenu.tsx` | ✅ Implemented | Fixed bottom navigation bar |
| 1:913 | `BoardForm` | `src/components/board/BoardForm.tsx` | ✅ Existing | Create board form |
| — | `BoardHeader` | `src/components/board/Header.tsx` | ✅ Existing | Section header |
| — | `Toggle` | `src/components/board/Toggle.tsx` | ✅ Existing | Toggle switch |
| — | `Counter` | `src/components/board/Counter.tsx` | ✅ Existing | Number counter |
| — | `TextInput` | `src/components/board/TextInput.tsx` | ✅ Existing | Text input field |
| — | `TextArea` | `src/components/board/TextArea.tsx` | ✅ Existing | Text area |
| — | `SubmitButton` | `src/components/board/SubmitButton.tsx` | ✅ Existing | Submit button |
| — | `FilePicker` | `src/components/board/FilePicker.tsx` | ✅ Existing | File upload |
| — | `LinkInputGroup` | `src/components/board/LinkInputGroup.tsx` | ✅ Existing | External link row |
| — | `BadgeList` | `src/components/board/BadgeList.tsx` | ✅ Existing | Badge display |
| — | `RiskPulse` | `src/components/board/RiskPulse.tsx` | ✅ Existing | Risk indicator |
| — | `BoardDetail` | `src/components/board/BoardDetail.tsx` | ✅ Existing | Board detail view |
| — | `WorkspaceWizard` | `src/components/board/WorkspaceWizard.tsx` | ✅ Existing | Workspace setup wizard |

---

## New Component: BottomMenu (2026-07-17)

### Figma Specification
- **Node**: 1:433 (`buttom-menu`)
- **Layout**: Row, 5px padding, 4px gap
- **Background**: #0A0A0A (via `--color-bg-primary-dark`)
- **Top Border**: Gradient (amber → teal → transparent → teal → amber)
- **Backdrop Filter**: blur(30px)
- **Height**: 54px functional / 88px designed (via `--size-bottom-menu-height` with clamp)

### Menu Items
| ID | Label | Icon (Tabler) | Route |
|----|-------|---------------|-------|
| boards | Доска | `IconLayoutList` | `/boards` |
| kanban | Стол | `IconGridDots` | `/board/kanban` |
| main | (empty) | `IconPlus` | `/board/create` |
| calendar | Календарь | `IconCalendarWeek` | `/board/calendar` |
| settings | Настройки | `IconSettings2` | `/settings` |

### Token Mapping
| Figma Property | CSS Token | Code Usage |
|----------------|-----------|------------|
| Background #0A0A0A | `--color-bg-primary-dark` | `bg-bottom-menu-bg` |
| Icon color inactive #8B8B8B | `--color-text-muted` | `var(--color-bottom-menu-text-inactive)` |
| Icon color active #FFFFFF | `--color-text-white` | `var(--color-bottom-menu-text-active)` |
| Icon size 20px | `--size-bottom-menu-icon` | `clamp(1.25rem, 3vw, 1.5rem)` |
| Main icon 40px | `--size-bottom-menu-icon-main` | `clamp(2.5rem, 6vw, 3rem)` |
| Label 8px | `--text-bottom-menu-label` | `clamp(0.5rem, 1.2vw, 0.625rem)` |
| Gap 4px | `--spacing-bottom-menu-gap` | `var(--spacing-1)` |
| Blur 30px | `--blur-bottom-menu` | `backdrop-blur-[var(--blur-bottom-menu)]` |
| Inner shadows | `--shadow-main-btn-*` | `boxShadow` on main button |

### Responsive Breakpoints
| Breakpoint | Behavior |
|------------|----------|
| Mobile (< 640px) | Compact layout, labels hidden on very small screens |
| sm (≥ 640px) | Labels visible, increased padding |
| md (≥ 768px) | Larger touch targets, text-xs labels |
| lg (≥ 1024px) | Max-width constraint centered |

### Accessibility
- `<nav>` element with `aria-label="Основная навигация"`
- Each link has `aria-label` describing its purpose
- Active items have `aria-current="page"`
- Focus-visible ring with accent color
- Keyboard navigable via standard link behavior

### Dependencies
- `@tabler/icons-react` v3.45.0 (installed)
- Next.js `Link` and `usePathname` for routing
- Design tokens from `src/styles/tokens.css`

### Integration
- Added to `app/layout.tsx` as **global layout component** (renders on every page)
- Body has bottom padding (`pb-[var(--size-bottom-menu-height)]`) to prevent content overlap
- Fixed positioning at bottom of viewport, z-index 50
- No duplicate instances in child pages (removed from `app/boards/page.tsx`)

---

## Updated Component: RiskPulse (2026-07-17)

### Bug Fix
- **Problem**: Grid was using inline `gridTemplateColumns` with a malformed CSS value, causing cards to stretch horizontally across the full width instead of forming a proper 3-column grid.
- **Solution**: Replaced inline style with Tailwind responsive grid classes:
  - `grid-cols-1` on mobile (single column)
  - `md:grid-cols-3` on tablet+ (three equal columns)
  - Removed unused `grid-responsive` class
  - Added responsive gap: `gap-2 sm:gap-4`
- **Note**: Changes made in `src/components/board/RiskPulse.tsx` — shared by both `app/` and `src/app/` routes.

### Token Mapping
| Figma Property | CSS Token / Class | Code Usage |
|----------------|-------------------|------------|
| Card background | `--color-bg-surface` | `backgroundColor` |
| Card border | `--color-border-default` | `border` |
| Card padding | `--spacing-3` | `padding` |
| Card gap | `--spacing-2` | `gap` |
| Label color | `--color-text-muted` | `color` |
| Value color | `--color-text-white` / `--color-error` | `color` |

---

*Last updated: 2026-07-17*
