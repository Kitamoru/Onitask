# Active Context

## Current Task: UI Design Update — NotchedPanel radius, SectionHeader amber, toggle animation (2026-07-22)

**Status**: 🔄 In Progress

**Changes Made:**

### 1. NotchedPanel.tsx — Default radius changed from 16 to 4 px
- File: `src/components/ui/desk-ui/NotchedPanel.tsx`
- Changed `radius = 16` → `radius = 4` in default props
- `notch` default remains `16` for large containers
- `notch` prop is already exposed for callers to override

### 2. Card.tsx — Added notch prop passthrough
- File: `src/components/ui/desk-ui/Card.tsx`
- Added optional `notch?: number` prop
- Passes `notch` through to `NotchedPanel`

### 3. StoryPointCostCard.tsx — Toggle-controlled content visibility with animation
- File: `src/components/desk-create/StoryPointCostCard.tsx`
- Content area wrapped in `<div>` with `transition-all duration-300 ease-in-out`
- Uses `max-h-[600px] opacity-100` when enabled, `max-h-0 opacity-0` when disabled
- Provides smooth slide-up/slide-down animation

### 4. SectionHeader.tsx — Already uses amber
- File: `src/components/ui/desk-ui/SectionHeader.tsx`
- Uses `bg-accent` which maps to `#ff9900` (amber) in Tailwind config
- No change needed — already correct

**Validation Status:**
- ⏳ `npm run type-check` — running (tsc --noEmit)
- ❌ `npm run lint` — pre-existing ESLint module resolution issue (unrelated to changes)

**Next Steps:**
- Verify TypeScript compilation passes
- Manually test UI in dev server
- Update design docs if needed