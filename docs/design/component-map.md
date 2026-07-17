# Component Map — Design → Code Reference

> **Purpose:** Catalog of UI components to track which Figma components have been implemented and which still need migration. Prevents duplication when migrating from Figma.
>
> **Last Updated:** 2026-07-16
> **Source Figma File:** [dev] ONITASK

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented & verified against Figma |
| ⚠️ | Partially implemented (some specs mismatch) |
| 🔲 | Not yet implemented |
| 🔄 | In progress |

---

## 1. Form Inputs

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `TextInput` | `src/components/board/TextInput.tsx` | `TextInputProps` | `7:7692`, `7:8090` | ✅ | 2026-07-15 | input-field-m/s, gradient border, sizes md/sm |
| `TextArea` | `src/components/board/TextArea.tsx` | `TextAreaProps` | `83:17453`, `83:17454` | ✅ | — | text-area-m, gradient border, character counter |
| `FilePicker` | `src/components/board/FilePicker.tsx` | `FilePickerProps` | `338:30067` | ✅ | — | input-field-s + upload icon, .md only |

### TextInputProps

```typescript
interface TextInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  label?: string;
  size?: 'md' | 'sm';
  showLeadingIcon?: boolean;
  showTrailingIcon?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  type?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  'aria-label'?: string;
}
```

### TextAreaProps

```typescript
interface TextAreaProps {
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  id?: string;
  label?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  error?: string;
  className?: string;
  'aria-label'?: string;
}
```

### FilePickerProps

```typescript
interface FilePickerProps {
  file?: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}
```

---

## 2. Controls

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `Toggle` | `src/components/board/Toggle.tsx` | `ToggleProps` | `22:5993`, `22:5997` | ✅ | 2026-07-15 | 48x24px, gradient border, nail 24px |
| `Counter` | `src/components/board/Counter.tsx` | `CounterProps` | `424:32469` | ✅ | — | minus/plus buttons, gradient border |

### ToggleProps

```typescript
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
  className?: string;
}
```

### CounterProps

```typescript
interface CounterProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}
```

---

## 3. Layout / Structural

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `BoardHeader` | `src/components/board/Header.tsx` | `HeaderProps` | `428:34028` | ✅ | 2026-07-15 | Amber line 2x18px + section title |
| `BadgeList` | `src/components/board/BadgeList.tsx` | `BadgeListProps` | `337:29243` | ✅ | — | Colleagues list with badge count |
| `LinkInputGroup` | `src/components/board/LinkInputGroup.tsx` | `LinkInputGroupProps` | — | ✅ | — | Resource name + URL inputs + add button |

### HeaderProps

```typescript
interface HeaderProps {
  title: string;
  action?: React.ReactNode;
}
```

### BadgeListProps

```typescript
interface Colleague {
  id: string;
  name: string;
  avatar?: string;
}

interface BadgeListProps {
  colleagues: Colleague[];
  onAddColleagues: () => void;
  addDisabled?: boolean;
  className?: string;
}
```

### LinkInputGroupProps

```typescript
interface LinkInputGroupProps {
  resourceName: string;
  onResourceNameChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  onAddLink: () => void;
  addDisabled?: boolean;
  className?: string;
}
```

---

## 4. Actions

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `SubmitButton` | `src/components/board/SubmitButton.tsx` | `SubmitButtonProps` | `7:7369` | ✅ | — | button-prim-s, gradient border, loading state |

### SubmitButtonProps

```typescript
interface SubmitButtonProps {
  children?: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}
```

---

## 5. Shared UI (`components/ui/`)

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `Badge` | `components/ui/badge.tsx` | `BadgeProps` | — | ✅ | — | Generic badge for counts/tags |

### BadgeProps

```typescript
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'outline';
  className?: string;
}
```

---

## 5. Risk & Metrics

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `RiskPulse` | `src/components/board/RiskPulse.tsx` | `RiskPulseProps`, `RiskPulseData` | `307:28401` | ✅ | 2026-07-16 | Aggregated risk across boards — Люди, Процессы, Эскалации |
| `BoardCard` | `src/components/board/BoardCard.tsx` | `BoardCardProps`, `BoardCardData`, `BoardStats`, `SprintInfo` | `307:28401` | ✅ | 2026-07-16 | Board/workspace card with stats grid + sprint row |

### RiskPulseProps

```typescript
interface RiskPulseProps {
  data: RiskPulseData;
}

interface RiskPulseData {
  people: number;
  processes: number;
  escalations: number;
}
```

### BoardCardProps

```typescript
interface BoardCardProps {
  data: BoardCardData;
  onClick?: () => void;
  isActive?: boolean;
}

interface BoardCardData {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string;
  memberCount: number;
  agentCount: number;
  stats: BoardStats;
  sprint?: SprintInfo;
}

interface BoardStats {
  inWork: number;
  escalations: number;
  overloaded: number;
  done: number;
}

interface SprintInfo {
  name: string;
  topic: string;
  daysElapsed: number;
  totalDays: number;
}
```

---

## 6. Board Detail / Page Components

| Component | File | Props Interface | Figma Node | Status | Last Verified | Notes |
|-----------|------|-----------------|------------|--------|---------------|-------|
| `BoardDetail` | `src/components/board/BoardDetail.tsx` | `BoardDetailProps` | `1:836` | ✅ | 2026-07-16 | Full board content view — Sprints, Colleagues, Links, Documents, Work Logic |

### BoardDetailProps

```typescript
interface BoardDetailProps {
  boardName: string;
  slug: string;
  sprint?: SprintInfo;
  sprintTasks: TaskCardData[];
  colleagues: WorkerCardData[];
  externalLinks: ExternalLinkData[];
  documents: DocumentData[];
  deadlineWarningDays: number;
  loading?: boolean;
}

interface SprintInfo {
  id: string;
  name: string;
  topic: string;
  startDate: string;
  endDate: string;
  daysElapsed: number;
  totalDays: number;
}

interface TaskCardData {
  id: string;
  title: string;
  column: string;
}

interface WorkerCardData {
  id: string;
  displayName: string;
  avatarUrl?: string;
  cognitiveWeight: number;
  spPerDay: number;
  trendUp: boolean;
  roleLabel: string;
  activeTasks: number;
  overloaded: boolean;
  tasks: string[];
}

interface ExternalLinkData {
  id: string;
  label: string;
  url: string;
}

interface DocumentData {
  id: string;
  filename: string;
  fileType: 'markdown' | 'text';
}
```

### Board Routes

| Route | Page File | Description |
|-------|-----------|-------------|
| `/boards` | `src/app/boards/page.tsx` | Boards overview (Стол) — RiskPulse + BoardCard list |
| `/board/[slug]` | `src/app/board/[slug]/page.tsx` | Board detail — full workspace content |
| `/board/create` | `src/app/board/create/page.tsx` | Create new board form |

---

## 7. Composite / Form Components

| Component | File | Description | Status |
|-----------|------|-------------|--------|
| `BoardForm` | `src/components/board/BoardForm.tsx` | Main form combining all create-board blocks (Основное, Функциональное, Мейты, Контекст) | ✅ |

### BoardFormData

```typescript
interface BoardFormData {
  name: string;
  slug: string;
  description?: string;
  spEnabled: boolean;
  spValues: Record<string, number>;
  cwEnabled: boolean;
  cwValue?: number;
  mates: string[];
  context?: string;
  links: Array<{ name: string; url: string }>;
  files?: File[];
}
```

---

## Pending Migration from Figma

| Block | Figma Node | Priority | Status | Notes |
|-------|------------|----------|--------|-------|
| Спринт управление | TBD | Medium | 🔲 | Sprint management page — /board/[slug]/sprints |
| Коллеги управление | TBD | Medium | 🔲 | Team members management — /board/[slug]/members |
| Редактирование доски | TBD | Medium | 🔲 | Board edit page — /board/[slug]/edit |
| Мейты (Mates) | TBD | Low | 🔲 | Invite teammates section — needs component |
| Контекст (Context) | TBD | Low | 🔲 | Workspace context section — needs component |
| Расширения (Extensions) | TBD | Low | 🔲 | Extensions section — needs component |
| Модули (Modules) | TBD | Low | 🔲 | Modules section — needs component |

---

## Design Tokens Reference

> ⚠️ **Last Updated:** 2026-07-17 — Все компоненты переведены на дизайн-токены. Hex-значения централизованы в `src/styles/tokens.css`.

### Colors (CSS Variables)

Все цвета определены в `src/styles/tokens.css` и используются через CSS-переменные:

| CSS Variable | Tailwind Class | Value | Usage |
|--------------|----------------|-------|-------|
| `--color-bg-primary-dark` | `bg-primary-dark` | `#0A0A0A` | Page background |
| `--color-bg-dark` | `bg-dark` | `#101010` | Secondary background |
| `--color-bg-surface` | `bg-surface` / `surface` | `#1A1A1A` | Card/input background |
| `--color-bg-surface-hover` | — | `#2A2A2A` | Hover state |
| `--color-bg-light` | `bg-light` | `#FAFAFA` | Primary text/background |
| `--color-text-primary` | `text-primary` | `#FAFAFA` | Primary text |
| `--color-text-muted` | `text-muted` | `#8B8B8B` | Placeholder, helper text |
| `--color-text-secondary` | `text-secondary` | `#808080` | Secondary text |
| `--color-text-white` | — | `#FFFFFF` | White text |
| `--color-accent-amber` | `accent-amber` | `#F59E0B` | Accent lines, buttons |
| `--color-accent-amber-subtle` | — | `rgba(245,158,11,0.1)` | Subtle accent bg |
| `--color-error` | `error` | `#EF4444` | Error messages |
| `--color-border-default` | `border-default` | `rgba(139,139,139,0.2)` | Default border |
| `--color-border-white-subtle` | — | `rgba(255,255,255,0.1)` | Subtle white border |

### Gradient Border Pattern

| CSS Variable | Value | Usage |
|--------------|-------|-------|
| `--gradient-border-start` | `rgba(250,250,250,0.38)` | Gradient start |
| `--gradient-border-mid` | `rgba(250,250,250,0.08)` | Gradient middle |
| `--gradient-border-end` | `rgba(250,250,250,0.38)` | Gradient end |

### Spacing (all in rem)

| CSS Variable | Tailwind Equivalent | Value | Usage |
|--------------|---------------------|-------|-------|
| `--spacing-0` | `0` | `0` | No spacing |
| `--spacing-0.5` | — | `0.125rem` (2px) | Tight gap |
| `--spacing-1` | `1` | `0.25rem` (4px) | Small gap |
| `--spacing-1.5` | `1.5` | `0.375rem` (6px) | Icon-text gap |
| `--spacing-2` | `2` | `0.5rem` (8px) | Medium gap |
| `--spacing-2.5` | — | `0.625rem` (10px) | Input padding sm |
| `--spacing-3` | `3` | `0.75rem` (12px) | Section padding |
| `--spacing-3.5` | — | `0.875rem` (14px) | Input padding md |
| `--spacing-4` | `4` | `1rem` (16px) | Standard gap |
| `--spacing-6` | `6` | `1.5rem` (24px) | Section gap |
| `--spacing-16` | `16` | `4rem` (64px) | Safe area |

### Border Radius

| CSS Variable | Tailwind Class | Value | Usage |
|--------------|----------------|-------|-------|
| `--radius-xs` | `rounded-xs` | `0.0625rem` (1px) | Avatar corner |
| `--radius-sm` | `rounded-sm` / `rounded-input-sm` | `0.25rem` (4px) | Input/button |
| `--radius-md` | `rounded-md` / `rounded-lg` | `0.375rem` (6px) | Large input |
| `--radius-card` | `rounded-card` / `rounded` | `0.5rem` (8px) | Card/container |

### Typography

| CSS Variable | Tailwind Class | Value | Usage |
|--------------|----------------|-------|-------|
| `--font-family-base` | `font-base` | `'Inter', system-ui, sans-serif` | Body text |
| `--font-family-display` | `font-display` | `'Inter Display', system-ui, sans-serif` | Headings |
| `--text-heading-sm` | `text-heading-sm` | `clamp(0.875rem, 1vw, 0.875rem)` | 14px heading |
| `--text-heading-md` | `text-heading-md` | `clamp(1rem, 1.2vw, 1rem)` | 16px heading |
| `--text-body-xs` | `text-body-xs` | `clamp(0.6875rem, 0.8vw, 0.6875rem)` | 11px body |
| `--text-body-sm` | `text-body-sm` | `clamp(0.75rem, 0.9vw, 0.75rem)` | 12px body |
| `--text-body-md` | `text-body-md` | `clamp(0.875rem, 1vw, 0.875rem)` | 14px body |
| `--text-body-lg` | `text-body-lg` | `clamp(1rem, 1.2vw, 1rem)` | 16px body |
| `--font-weight-regular` | — | `400` | Regular |
| `--font-weight-medium` | — | `500` | Medium |
| `--font-weight-semibold` | — | `600` | SemiBold |

### Typography

| Style | Font | Weight | Sizes |
|-------|------|--------|-------|
| Headings | Inter Display | Medium 500, SemiBold 600 | 14px/18px, 16px/20px |
| Body | Inter | Regular 400, Medium 500 | 12px/16px, 14px/18px, 16px/20px |

### Spacing

| Token | Value | Usage |
|-------|-------|-------|
| Section gap | `24px` | Between form sections |
| Section padding | `12px` | Internal section padding |
| Input padding (s) | `10px 12px` | Small inputs |
| Input padding (m) | `14px 12px` | Large inputs |
| Form max-width | `358px` | Content width constraint |
| Gap small | `6px` | Between icon and text |
| Gap medium | `8px` | Between elements |

### Border Gradient Pattern

All inputs use the same gradient border technique via mask composite:

```css
backgroundImage: linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%);
mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
maskComposite: exclude;
WebkitMaskComposite: xor;
padding: 1px;
```

### Border Radius

| Element | Radius |
|---------|--------|
| Input (s) | `4px` |
| Input (m) | `6px` |
| Button | `4px` |
| Toggle nail | `2px` |

---

## How to Use This Map

### When migrating a new component from Figma:

1. **Check if it already exists** — search the table by name or Figma node ID
2. **If it exists** — update the row with new Figma node, verify status
3. **If it's new** — add a new row in the appropriate category table
4. **After implementation** — mark status as ✅ and set Last Verified date
5. **Update Pending Migration** — remove migrated blocks, add new ones

### When reviewing a Figma component:

1. Look up the Figma node ID in this map
2. Check the current implementation status
3. If ✅ — compare specs (spacing, typography, colors) against the existing code
4. If ⚠️ or 🔲 — plan implementation or update

---

*Created: 2026-07-16 · Maintained in `docs/design/component-map.md`*