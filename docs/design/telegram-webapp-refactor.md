# Telegram Web App Frontend Refactoring — Complete Documentation

## Overview

This document describes the complete refactoring of the Onitask frontend for proper Telegram Web App integration. The changes address positioning issues, mobile responsiveness, safe-area handling, and dynamic theme switching.

---

## Files Modified

### 1. `src/app/globals.css` — Foundation Styles

**Changes:**
- Added Telegram Theme Variables (`--tg-theme-bg-color`, `--tg-theme-text-color`, etc.) with fallbacks to design tokens
- Added Safe Area Inset support via `env(safe-area-inset-*)` CSS functions
- Added `-webkit-tap-highlight-color: transparent` to remove blue tap highlight on mobile
- Added `overscroll-behavior-y: contain` to prevent bounce scrolling on iOS
- Changed `min-height` from `100vh` to `100dvh` (dynamic viewport height) for keyboard handling
- Added `.tg-webapp` class selector for Telegram-specific body styling
- Added safe-area utility classes: `.pt-safe-top`, `.pb-safe-bottom`, `.pl-safe-left`, `.pr-safe-right`
- Added `.content-with-safeties` class for main content wrapper
- Added `.card-stretch` active scale animation for touch feedback
- Added `.animate-slide-up` keyframe animation for modal panels
- Added `react-day-picker` overrides using Telegram theme variables

**Key CSS additions:**
```css
/* Telegram Theme Variables */
:root {
  --tg-theme-bg-color: var(--color-bg-primary-dark);
  --tg-theme-text-color: var(--color-text-primary);
  --tg-theme-button-color: var(--color-accent-amber);
  /* ... more vars */
}

/* Safe area padding utilities */
.pb-safe-bottom { padding-bottom: max(var(--spacing-4), env(safe-area-inset-bottom, 0px)); }
.pt-safe-top    { padding-top: max(var(--spacing-4), env(safe-area-inset-top, 0px)); }
```

---

### 2. `tailwind.config.ts` — Configuration Updates

**Changes:**
- Added `xs: '480px'` breakpoint for small mobile devices
- Updated all color values to use Telegram theme variables as primary source
- Added safe-area spacing tokens: `safe-top`, `safe-bottom`, `safe-left`, `safe-right`
- Added `minHeight` utilities: `screen-dvh`, `screen-svh`, `screen-vh`
- Added `maxWidth` utilities: `mobile` (480px), `mobile-sm` (390px), `form` (358px)
- Added custom `zIndex` values: `modal` (100), `toast` (90), `bottom-menu` (50)

**Color mapping changes:**
| Old Token | New Primary Source | Fallback |
|-----------|-------------------|----------|
| `bg-primary-dark` | `--tg-theme-bg-color` | `--color-bg-primary-dark` |
| `text-primary` | `--tg-theme-text-color` | `--color-text-primary` |
| `text-muted` | `--tg-theme-hint-color` | `--color-text-muted` |
| `accent-amber` | `--tg-theme-button-color` | `--color-accent-amber` |
| `surface` | `--tg-theme-secondary-bg-color` | `--color-bg-surface` |

---

### 3. `src/components/shared/TelegramTheme.tsx` — NEW Component

**Purpose:** React context provider for Telegram theme integration.

**Features:**
- Reads `Telegram.WebApp.themeParams` on mount
- Applies CSS custom properties to `document.documentElement`
- Adds `tg-webapp` class to `<html>` for CSS targeting
- Subscribes to `themeChanged` event for live updates
- Provides stable theme state via React context

**Usage:**
```tsx
// In layout.tsx
<TelegramThemeProvider>
  {children}
</TelegramThemeProvider>

// In any component
const theme = useTelegramThemeContext();
// theme.bgColor, theme.textColor, theme.buttonColor, etc.
```

---

### 4. `src/hooks/useTelegramTheme.ts` — NEW Hook

**Purpose:** Standalone hook for components that need direct access to Telegram theme without context.

**Features:**
- Same functionality as TelegramThemeProvider but as a hook
- Returns `{ isAvailable, theme, applyTheme }`
- Can be used independently in any component

---

### 5. `src/app/layout.tsx` — Root Layout

**Changes:**
- Wrapped body with `<TelegramThemeProvider>`
- Added `bg-primary-dark text-text-primary` to body className
- Changed `min-h-full` to `min-h-screen-dvh` for dynamic viewport
- Added `suppressHydrationWarning` to handle SSR/CSR mismatch

---

### 6. `src/components/shared/BottomMenu.tsx` — Bottom Navigation

**Changes:**
- Changed `z-50` to `z-bottom-menu` (uses custom z-index from config)
- Changed `bg-bottom-menu-bg` to `bg-primary-dark` (uses Telegram theme)
- Added responsive padding: `xs:px-1 sm:px-2 md:px-4`
- Added `pb-safe-bottom` class for safe area
- Updated inline styles to use `max()` with `env(safe-area-inset-*)` for all padding sides

**Before:**
```tsx
className="fixed bottom-0 left-0 right-0 z-50 ..."
style={{ padding: 'var(--spacing-bottom-menu-padding)' }}
```

**After:**
```tsx
className="fixed bottom-0 left-0 right-0 z-bottom-menu pb-safe-bottom ..."
style={{
  paddingBottom: 'max(var(--spacing-bottom-menu-padding), env(safe-area-inset-bottom))',
  paddingLeft: 'max(var(--spacing-bottom-menu-padding), env(safe-area-inset-left))',
  paddingRight: 'max(var(--spacing-bottom-menu-padding), env(safe-area-inset-right))',
}}
```

---

### 7. `src/components/flowboard/FlowBoard.tsx` — Main Content

**Changes:**
- Changed container to use `bg-primary-dark` (Telegram theme-aware)
- Changed `min-h-screen` to `min-h-screen-dvh`
- Added `pt-safe-top pb-safe-bottom` for safe area
- Added `xs:p-3 sm:p-4` responsive padding
- Added `shrink-0` to header row to prevent compression
- Added `minWidth: 0` to grid containers to prevent overflow on small screens
- Changed bottom spacer to responsive height: `h-16 xs:h-20`
- Used `calc(100dvh - var(--size-bottom-menu-height))` for proper content height

**Container before:**
```tsx
<div className="flex flex-col mx-auto p-4" style={{ minHeight: '100vh' }}>
```

**Container after:**
```tsx
<div className="flex flex-col w-full mx-auto xs:p-3 sm:p-4 bg-primary-dark min-h-screen-dvh pt-safe-top pb-safe-bottom"
     style={{ minHeight: 'calc(100dvh - var(--size-bottom-menu-height))' }}>
```

---

### 8. `src/components/calendar/CalendarView.tsx` — Calendar Modal

**Changes:**
- Modal uses `fixed inset-x-0` instead of `fixed inset-0` for full-width on mobile
- Added `z-modal` for proper layering
- Added `pb-safe-bottom` to prevent overlap with safe area
- Calculates `tgBottomOffset` from `Telegram.WebApp.mainButton.height`
- Panel background uses `--tg-theme-bg-color`
- All text colors use `--tg-theme-text-color` / `--tg-theme-hint-color`
- Button colors use `--tg-theme-button-color`
- Surface backgrounds use `--tg-theme-secondary-bg-color`
- Added `active:scale-95` for touch feedback on buttons
- Fixed duplicate `maxHeight` property

**Modal positioning fix:**
```tsx
const tgBottomOffset = typeof window !== 'undefined'
  ? ((window as any).Telegram?.WebApp?.mainButton?.height || 0)
  : 0;

// Panel avoids MainButton + safe area
style={{ paddingBottom: Math.max(tgBottomOffset, safeAreaBottom, 16) + 'px' }}
```

---

### 9. `src/components/board/BoardForm.tsx` — Form Container

**Changes:**
- Changed `max-w-[358px]` to `max-w-form` (uses Tailwind config token)
- Added `xs:px-3 sm:px-4` responsive horizontal padding
- Added `pt-safe-top pb-safe-bottom` for safe area
- Added `minHeight: '100dvh'` for full viewport height
- Background uses `bg-primary-dark` (Telegram theme-aware)

---

## How Telegram Theme Switching Works

```
User changes theme in Telegram
        │
        ▼
Telegram SDK fires 'themeChanged' event
        │
        ▼
TelegramThemeProvider catches event
        │
        ▼
Reads new values from tg.themeParams
        │
        ▼
Applies CSS custom properties to document.documentElement
        │
        ▼
Tailwind classes like bg-primary-dark automatically update
        │
        ▼
React re-renders with new computed styles
```

**No page reload required.** The theme switches instantly because we use CSS custom properties that Tailwind reads at runtime.

---

## Mobile Testing Checklist

### ✅ Layout & Positioning
- [ ] Content doesn't overflow horizontally on 320px screens
- [ ] Grid columns wrap properly on narrow screens
- [ ] No horizontal scrollbars
- [ ] Bottom menu doesn't overlap content

### ✅ Safe Area
- [ ] Notched devices: content respects top/bottom safe areas
- [ ] Dynamic Island: no content hidden behind notch
- [ ] Home indicator: bottom padding accounts for swipe gesture

### ✅ Keyboard Handling
- [ ] Input fields remain visible when keyboard opens
- [ ] Modal panels resize correctly with keyboard
- [ ] Form scrolls to show focused input

### ✅ Theme Switching
- [ ] Light theme: all elements adapt colors
- [ ] Dark theme: all elements adapt colors
- [ ] Accent color changes affect buttons
- [ ] No hardcoded colors remain in key components

### ✅ Touch Feedback
- [ ] Buttons show active state on tap
- [ ] Cards have subtle scale animation on press
- [ ] No blue tap highlight overlay

---

## Validation Commands

```bash
# Type check
npm run type-check

# Lint
npm run lint

# Build
npm run build

# Dev server (test in browser with mobile emulation)
npm run dev
```

### Browser Testing
1. Open `http://localhost:3000`
2. Open Chrome DevTools (F12)
3. Toggle Device Toolbar (Ctrl+Shift+M)
4. Select iPhone SE (375×667) or iPhone 14 Pro (393×852)
5. Enable "Emulate CSS media feature prefers-color-scheme: dark"
6. Test safe area by adding CSS: `* { outline: 1px solid red; }` on `body::before`

### Telegram Testing
1. Deploy to Vercel: `vercel deploy`
2. Open bot in Telegram with Mini App URL
3. Change theme in Telegram settings
4. Verify instant color transition
5. Open keyboard and verify layout adjustment

---

## Known Limitations

1. **SSR Hydration**: Theme variables are applied client-side only. First paint may flash default dark theme before Telegram loads. This is acceptable for TWA.

2. **Desktop Fallback**: When not running inside Telegram, all `--tg-theme-*` variables fall back to our design tokens, so the app still works in browsers.

3. **react-day-picker**: Third-party calendar library requires manual CSS overrides. Some internal elements may not fully respect theme variables.

4. **MainButton Height**: The `mainButton.height` property is only available after the button is shown. We default to 0 if unavailable.

---

## Future Improvements

1. Add `@tailwindcss/forms` plugin for consistent form styling
2. Create reusable `TelegramButton`, `TelegramCard`, `TelegramInput` components
3. Add viewport change handler for keyboard resize
4. Implement pull-to-refresh with Telegram's native gestures
5. Add haptic feedback integration via Telegram SDK