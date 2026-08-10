# Component Map — Onitask Design System

## Overview
This document maps Figma components to their code implementations in the Onitask project.
All components use design tokens from `src/styles/tokens.css` (no hardcoded hex values).

**Maintenance Rule**: When adding/modifying components, update this file immediately. See `.clinerules/.clinerules` § Front-End & Figma Code Generation Rules.

---

## 1. UI Kit (Atomic) — `src/components/ui/desk-ui/`

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | Button | Button.tsx | variant, corner, disabled, className | Solid/outline button |
| | Card | Card.tsx | children, className | Basic container |
| | NotchedPanel | NotchedPanel.tsx | corner, radius, notch, borderWidth, borderGradient, border, fill, contentClassName | Panel with chamfered corners |
| | SectionHeader | SectionHeader.tsx | title | Section title with amber accent bar |
| | Stepper | Stepper.tsx | value, min, max, onChange, unitLabel, borderGradient, disabled | Number stepper with gradient border |
| | TextInput | TextInput.tsx | value, onChange, placeholder, disabled | Text input field |
| | TextArea | TextArea.tsx | value, onChange, placeholder, disabled | Multiline text input |
| | ToggleSwitch | ToggleSwitch.tsx | checked, onChange, label, disabled | On/off toggle |
| | CountBadge | CountBadge.tsx | count | Number badge |

---

## 2. Feature Components

### board/ — Boards

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | BoardCard | BoardCard.tsx | data, onClick, isActive, isSelected, onSelect | Board card in list |
| | BoardDetail | BoardDetail.tsx | boardName, slug, sprint, sprintTasks, colleagues, externalLinks, documents, deadlineWarningDays, boardSettings, loading | Board detail view (read-only). Uses desk-create sections in disabled mode |
| | RiskPulse | RiskPulse.tsx | data | Risk indicators grid |
| | WorkspaceWizard | WorkspaceWizard.tsx | — | Workspace setup wizard |

**Types**: `BoardCardData`, `BoardStats`, `SprintInfo`, `BoardDetailProps`, `WorkerCardData`, `ExternalLinkData`, `DocumentData`

---

### desk-create/ — Board Creation/Editing

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | CreateDeskForm | CreateDeskForm.tsx | onSubmit, onAddColleague | Board creation form |
| | EditDeskForm | EditDeskForm.tsx | workspaceId, initialData, onAddColleague | Board editing form |
| | BasicInfoSection | BasicInfoSection.tsx | name, slug, onNameChange, onSlugChange, disabled | Name + @desk input |
| | StoryPointCostCard | StoryPointCostCard.tsx | enabled, onEnabledChange, hoursBySp, onHoursChange, disabled | SP cost config |
| | CognitiveWeightCard | CognitiveWeightCard.tsx | enabled, onEnabledChange, disabled | Cognitive weight toggle |
| | CoworkingSection | CoworkingSection.tsx | colleagueCount, onAddColleague, disabled | Colleagues section |
| | ContextSection | ContextSection.tsx | value, onChange, disabled | Context textarea |
| | DocumentsCard | DocumentsCard.tsx | enabled, onEnabledChange, files, onFilesChange, disabled | File upload |
| | ExternalLinksCard | ExternalLinksCard.tsx | enabled, onEnabledChange, links, onLinksChange, disabled | External links |
| | TrafficLightCard | TrafficLightCard.tsx | enabled, warningDays, urgentDays, onWarningDaysChange, onUrgentDaysChange, disabled | Deadline signals |

**Types**: `CreateDeskFormValue`, `EditDeskFormValue`, `ExternalLink`

---

### calendar/ — Calendar

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | CalendarView | CalendarView.tsx | — | Main calendar view |
| | CalendarTabs | CalendarTabs.tsx | — | Calendar tab navigation |
| | DayView | DayView.tsx | — | Day view |
| | ThreeDaysView | ThreeDaysView.tsx | — | 3-day view |
| | MonthListView | MonthListView.tsx | — | Month list view |
| | ListView | ListView.tsx | — | List view |

---

### flowboard/ — Flow Board

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | FlowBoard | FlowBoard.tsx | title, currentDate, sprint, signals, taskStatuses, workers, agents, loading, error, onAddWorker, onAddAgent, onRefresh, isNewUser, onBoardCreate | Main flow board. Uses desk-ui `SectionHeader` and `Button`. Manages sprint sheet state internally. |
| | TaskForm | TaskForm.tsx | onSubmit, onCancel, defaultColumn, className | Task creation form. Uses desk-ui `TextInput`, `TextArea`, `Button` |
| | UrgencyBadge | UrgencyBadge.tsx | deadline, size | Urgency indicator. Uses design tokens for colors and spacing |
| | OnboardingModal | OnboardingModal.tsx | onSuccess, onClose | Onboarding modal. Uses CSS variables instead of hardcoded colors |
| | PersonCard | FlowBoard.tsx | person, type | Worker/agent card. Exported from index |
| | UserAvatar | FlowBoard.tsx | displayName, avatarUrl, size | Avatar component. Exported from index |
| | CognitiveWeightIndicator | FlowBoard.tsx | weight | Cognitive weight dots. Exported from index |
| | PriorityBadge | FlowBoard.tsx | label, color | Priority badge. Uses CSS variables for colors + `task-shape-rhombus.svg` (amber rhombus marker) |
| | SprintCompressedInfo | FlowBoard.tsx | sprint | Sprint progress bar and statistics. Uses `progress-bar-track.svg` (green #4ADE80), `divider.svg`. Background `var(--color-surface)` (matches RiskPulse). Clickable → opens SprintViewSheet or SprintCreateSheet |
| | TaskViewEdit | TaskViewEdit.tsx | task, mode ('view' \| 'edit'), workers, onSave, onCancel, onClose | Task view/edit 2-in-1 component. In `view` mode all fields are locked (read-only); in `edit` mode fields are active. Uses desk-ui `TextInput`, `TextArea`, `Button`, `ToggleSwitch`, `SectionHeader`. Handles title, description, tags, priority, deadline, assignee, reviewer, story points, cognitive weight, blocked flag, handoff. |

**Exports** (`index.ts`): `FlowBoard`, `PersonCard`, `UserAvatar`, `CognitiveWeightIndicator`, `PriorityBadge`, `OnboardingModal`, `SprintCompressedInfo`, `TaskViewEdit`
**Types**: `FlowBoardProps`, `SprintInfo`, `SignalData`, `TaskStatusData`, `WorkerCardData`, `AgentCardData`, `TaskViewEditProps`

---

### stream/ — Task Stream

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | StreamView | StreamView.tsx | tasks, currentDate, cognitiveWeight, loadStatus, loading, error, onRefresh | Task stream view (Figma "desks-stream"). Reuses NotchedPanel, SectionHeader, Button, CognitiveWeightIndicator, PriorityBadge, UrgencyBadge |

**Exports** (`index.ts`): `StreamView`
**Types**: `StreamViewProps`

---

### sprint/ — Sprint Management

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | SprintCreateSheet | SprintCreateSheet.tsx | open, onClose, onSubmit | BottomSheet for creating a new sprint (name, dates, goal, capacity, task picker) |
| | SprintEditSheet | SprintEditSheet.tsx | open, onClose, initialValue, stats, onSubmit | BottomSheet for editing sprint details. Fields match SprintCreateSheet (Название, Даты, Цель, Ёмкость, Задачи) + stats display |
| | SprintViewSheet | SprintViewSheet.tsx | open, onClose, sprint, stats, isActive, onEdit, onComplete | BottomSheet for viewing sprint details, progress bar, edit/complete actions |
| | SprintCard | SprintCard.tsx | sprint, onClick | Clickable wrapper around SprintCompressedInfo |
| | Field | Field.tsx | label, children | Label wrapper for form fields |
| | StatBox | StatBox.tsx | label, value, valueTone | Stat display block using NotchedPanel |
| | TasksAccordionRow | TasksAccordionRow.tsx | taskCount, tasks | Accordion for selecting tasks to add to sprint |
| | types | types.ts | — | SprintFormValue, SprintStats type definitions |

**Re-exports** (`index.ts`): `SprintCreateSheet`, `SprintEditSheet`, `SprintViewSheet`, `StatBox`, `Field`, `TasksAccordionRow`, `SprintFormValue`, `SprintStats`

---

### ui/ — Shared UI Primitives

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | BottomSheet | BottomSheet.tsx | open, onClose, children | Slide-up panel with backdrop overlay (portal-based) |
| | DateRangeField | DateRangeField.tsx | startDate, endDate, onOpen, placeholder | Date range display field |
| | DateRangeSheet | DateRangeSheet.tsx | open, onClose, startDate, endDate, onConfirm | BottomSheet with react-day-picker for date range selection |

**Types**: `SprintFormValue` ({ name, startDate, endDate, goal, capacity }), `SprintStats` ({ completedTasks, totalTasks, daysLeft })

---

### shared/ — Shared

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | BottomMenu | BottomMenu.tsx | onCenterClick | Bottom navigation bar. Central button triggers `onCenterClick` or shows fallback notice. "Доска" button toggles between `/flowboard` and `/flowboard?view=stream` when already on flowboard |
| | AiTaskCreator | AiTaskCreator.tsx | — | Global wrapper: BottomMenu + AI task creation overlay (AiInput + CorrectionSheet). Opens on center button click, creates task via `/api/tasks`, refreshes metrics |
| | TelegramInit | TelegramInit.tsx | — | Telegram WebApp init |
| | TelegramProvider | TelegramProvider.tsx | children | Telegram context provider |
| | TelegramTheme | TelegramTheme.tsx | children | Theme provider |
| | TelegramViewportBridge | TelegramViewportBridge.tsx | — | Viewport height bridge |
| | AuthLoader | AuthLoader.tsx | children | Auth loading wrapper |
| | GlobalLoader | GlobalLoader.tsx | — | Global loading spinner |

---

## 3. Figma → Code Mapping

| Figma Node | Component | File | Status |
|------------|-----------|------|--------|
| 1:433 | BottomMenu | BottomMenu.tsx | ✅ |
| 1:913 | BoardForm | CreateDeskForm.tsx | ✅ |
| desk card | BoardCard | BoardCard.tsx | ✅ |
| desk detail | BoardDetail | BoardDetail.tsx | ✅ |
| task-card | BoardCard | BoardCard.tsx | ✅ |
| risk-pulse | RiskPulse | RiskPulse.tsx | ✅ |
| 98:6093 desks-stream | StreamView | StreamView.tsx | ✅ |

---

*Last updated: 2026-08-06*
