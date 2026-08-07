# Swipe UX Improvements — Progressive Visual Feedback

**Date:** 2026-08-07  
**File:** `src/components/flowboard/SwipeableTaskCard.tsx`

## Overview

Added progressive visual feedback to swipeable task cards to make the swipe gesture feel more controlled and predictable. Previously, the card would abruptly transition from drag to exit at the 80px threshold without any visual warning. Now the card provides continuous visual feedback throughout the swipe distance.

## Changes Made

### 1. Progressive Opacity & Scale

```typescript
// At 0% progress (start of drag): opacity 0.6, scale 0.97
// At 100% progress (at threshold): opacity 1.0, scale 1.0
const fadeOpacity = 0.6 + swipeProgress * 0.4;
const pressScale = 0.97 + swipeProgress * 0.03;
```

**Effect:** Card "dims" slightly at the start of a drag, then "wakes up" as it approaches the swipe threshold. This gives users clear visual feedback about how close they are to triggering the swipe.

### 2. Soft Bounce-Back Easing

Changed from:
```css
transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) /* overshoot/bouncy */
```

To:
```css
transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) /* Material Design standard, no overshoot */
```

**Effect:** When the user releases before reaching the threshold, the card snaps back smoothly without the previous "spring" effect that felt abrupt.

### 3. Two-Step Haptic Feedback

| Progress | Haptic | Purpose |
|----------|--------|---------|
| 50% | 10ms (light tap) | Subtle confirmation that swipe is being tracked |
| 100% | 50ms (main) | Confirmation that swipe will trigger |

**Effect:** Users get tactile feedback at two key moments, reinforcing the connection between their gesture and the UI response.

### 4. State Management

New state variables:
- `swipeProgress` (number): 0..1 value tracking how close the drag is to the threshold
- `hasVibratedAt50Ref` (boolean): prevents duplicate haptic feedback per swipe gesture

Reset on touch/mouse start:
```typescript
setSwipeProgress(0);
hasVibratedAt50Ref.current = false;
```

## User Experience Flow

```
Start drag (0%)
  └─→ Card dims (opacity 0.6, scale 0.97)
      │
      ├─→ Release here → smooth bounce-back
      │
40% progress
  └─→ Card starts "waking up" (opacity 0.76, scale 0.98)
      │
      ├─→ Release here → smooth bounce-back
      │
50% progress
  └─→ Light haptic tap (10ms)
      │
      ├─→ Release here → smooth bounce-back
      │
80% progress (threshold)
  └─→ Card fully bright (opacity 1.0, scale 1.0)
      └─→ Main haptic (50ms)
          └─→ Swipe triggers → card exits screen
```

## Constants Reference

| Constant | Value | Purpose |
|----------|-------|---------|
| `SWIPE_THRESHOLD` | 80px | Distance needed to trigger swipe |
| `SWIPE_MAX_TIME` | 500ms | Max time for fast-swipe detection |
| `SWIPE_EXIT_DURATION` | 300ms | Duration of exit animation |
| `EXIT_EASING` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Telegram-style ease-out for exit |
| `BOUNCE_EASING` | `cubic-bezier(0.4, 0, 0.2, 1)` | Material Design standard for bounce-back |

## Platform Standards Compliance

| Standard | Threshold | Current | Status |
|----------|-----------|---------|--------|
| Apple HIG | 40-60pt | 80px (~60pt) | ✅ Compliant |
| Material Design | 50-70dp | 80px (~60dp) | ✅ Compliant |
| Telegram | 60-80px | 80px | ✅ Compliant |

## Testing Checklist

- [ ] Swipe on iPhone (Safari) — verify smooth opacity/scale transitions
- [ ] Swipe on Android (Chrome) — verify haptic feedback at 50% and 100%
- [ ] Release at 30% — verify smooth bounce-back (no spring)
- [ ] Release at 60% — verify smooth bounce-back (no spring)
- [ ] Full swipe to 80% — verify swipe triggers with haptic
- [ ] Desktop mouse drag — verify visual feedback works without haptics
- [ ] Fast swipe (< 500ms, > 60px) — verify fast-swipe still works

## SSR/Prerender Fix

**Problem:** Next.js prerender failed with `TypeError: Cannot read properties of null (reading 'useRef')` on `/flowboard` page.

**Root Cause:** `SwipeableTaskCard` uses `useRef`, which cannot be serialized during server-side rendering when imported statically into a component tree that gets prerendered.

**Solution:** Changed import in `ColumnTasksSheet.tsx` from static to dynamic lazy import:
```typescript
const SwipeableTaskCard = lazy(() =>
  import('@/components/flowboard/SwipeableTaskCard').then((mod) => ({ default: mod.SwipeableTaskCard })),
);
```

Wrapped each card in `<Suspense>` with a fallback placeholder. This ensures the swipe component only loads client-side after hydration.

## Future Enhancements (Not Implemented)

1. **Direction hint icon**: Show arrow at 40%+ progress
2. **Velocity-based detection**: Add px/s velocity calculation
3. **Adaptive threshold**: Lower threshold for screens < 375px width
4. **Telegram native gestures**: Integrate with Telegram.WebApp gesture system