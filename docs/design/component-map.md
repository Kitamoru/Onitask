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
| | Segments | Segments.tsx | options, value, onChange, disabled | Segmented control (Figma "segments" 441:48462). Used in task-create wizard for "Поэтапно"/"Всё сразу" |
| | ProgressSteps | ProgressSteps.tsx | current, total | Step progress bar (Figma "progressbar" 439:33993). Active stage amber, inactive amber 20% |

---

## 2. Feature Components

### board/ — Boards

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | BoardCard | BoardCard.tsx | data, onClick, isActive, isSelected, onSelect | Board card in list |
| | BoardViewEdit | BoardViewEdit.tsx | workspaceId, canEdit, initialMode ('view' \| 'edit'), initialData, serverDocuments, availableColleagues, memberCount | Board detail view/edit 2-in-1 (pattern of TaskViewEdit). Single canvas of desk-create sections; view mode = fields disabled + solid «Редактировать» (only owner); edit mode = save / delete (owner). Mode = local state, switch without navigation/refetch |
| | RiskPulse | RiskPulse.tsx | data | Risk indicators grid |
| | WorkspaceWizard | WorkspaceWizard.tsx | — | Workspace setup wizard |

**Types**: `BoardCardData`, `BoardStats`, `SprintInfo`, `BoardViewEditProps`, `WorkerCardData`, `ExternalLinkData`, `DocumentData`

---

### desk-create/ — Board Creation/Editing

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | CreateDeskForm | CreateDeskForm.tsx | onSubmit, onAddColleague | Board creation form |
| | BasicInfoSection | BasicInfoSection.tsx | name, slug, onNameChange, onSlugChange, disabled | Name + @desk input |
| | StoryPointCostCard | StoryPointCostCard.tsx | enabled, onEnabledChange, hoursBySp, onHoursChange, disabled | SP cost config |
| | CognitiveWeightCard | CognitiveWeightCard.tsx | enabled, onEnabledChange, disabled | Cognitive weight toggle |
| | CoworkingSection | CoworkingSection.tsx | colleagueCount, onAddColleague, disabled | Colleagues section |
| | ContextSection | ContextSection.tsx | value, onChange, disabled | Context textarea |
| | DocumentsCard | DocumentsCard.tsx | enabled, onEnabledChange, files, onFilesChange, disabled | File upload |
| | ExternalLinksCard | ExternalLinksCard.tsx | enabled, onEnabledChange, links, onLinksChange, disabled | External links |
| | TrafficLightCard | TrafficLightCard.tsx | enabled, warningDays, urgentDays, onWarningDaysChange, onUrgentDaysChange, disabled | Deadline signals |

**Types**: `CreateDeskFormValue`, `ExternalLink`

---

### calendar/ — Calendar

**Screen shape (2026-09-26):** a Telegram Mini App lives in a draggable BottomSheet, so the
calendar is two views on one scale — «День» and «Месяц» — not a four-way switcher. The month grid
is an orientation aid (day number, presence dots, count) and hands off to the day view on a tap;
it is not a surface for event titles. The previous `CalendarView` (react-day-picker month grid with
20-character truncated chips), `ListView`, `MonthListView`, `ThreeDaysView` and the unused
`month-list` / `list` / `three-days` view modes were removed — they were either unreachable or
duplicated the same provider-colour logic five times. `react-day-picker` stays in the project for
`SingleDateSheet` / `DateRangeSheet`.

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | CalendarTabs | CalendarTabs.tsx | activeMode, onModeChange | «День» / «Месяц» switcher; 2 segments, `CalendarViewMode = 'day' \| 'month'` |
| | WeekStrip | WeekStrip.tsx | selectedDate, onDateSelect, eventCounts | iOS-style Monday-first week strip; a dot marks a day that has events, the count is in the accessible name |
| | DayView | DayView.tsx | date, events, onEventClick, isLoading | One day on a proportional time axis (44px per hour). Blocks are placed by real start and duration, overlapping events split into lanes, current-time marker on today. Opens scrolled to now, else to the first event. An empty day is a plain empty axis: the floating "nothing planned" notice that used to sit here was removed because it rendered over the bottom menu |
| | MonthView | MonthView.tsx | month, onMonthChange, selectedDate, onDateSelect, events | Month grid for orientation; readable dots and an overflow count. Selecting a day switches to the day view |
| | AllDayRow | AllDayRow.tsx | events, onEventClick | Whole-day events for the selected day, shown above the hour axis |
| | EventDetailSheet | EventDetailSheet.tsx | event, onClose, onEditReminder | Event details on the shared `BottomSheet`; wires up the tap that previously did nothing. URLs in the description are split out and opened via `Telegram.WebApp.openLink` |

**All-day events are not instants.** `calendar_events.is_all_day` (migration 124) marks iCal
`VALUE=DATE` entries, whose `start_at` is a UTC midnight marker rather than a clock time. They are
rendered in `AllDayRow` above the axis, never placed on it — otherwise they land at 00:00–03:00 for
any user east of Greenwich. `parseVEvents` flags both explicit `VALUE=DATE` and a bare 8-character
date.

**Type scale.** Page and sheet titles are 20/24/500 (same as the «Стол» and «Настройки» headers) with
a 20px `@tabler/icons-react` glyph, not an emoji. Sheet content is `--text-body-md` (14px). Day and
month cells carry their accessible name in text — date, current-month state, today, event count —
never colour alone.

**Day keys are local, not UTC.** `localDateKey` in `lib/calendar` is the single source of truth;
`toISOString().split('T')[0]` files a 00:30 event under the previous day east of Greenwich. Covered
by `tests/lib/calendar.test.ts`, which pins `TZ=Europe/Moscow` because the failure is invisible on a
UTC runner.

---

### flowboard/ — Flow Board

**TaskCard blocked state (2026-09-24):** при `tasks.is_blocked=true` общий `TaskCard` первым badge показывает compact pure-red бейдж «Заблокирована» (`TaskBlockedBadge.tsx`). Чистый красный `#FF0000` семантически отделён от кораллового приоритета «Высокий» (`#EF4444`) и destructive-красного (`#FF2B3A`). Без иконки, без изменения порядка и без дополнительного API-вызова; автоматически виден в `ColumnTasksSheet` и Stream.
**Operator Queue (AGENT-03/NAV-01, 2026-09-25):** `OperatorQueueSheet.tsx` — oldest-first очередь с readable reasons, `suggested_action`, `nack_*`, loading/error/empty states, подтверждением и атомарным «Попробовать снова». На Flow Board scope=`workspace`; на `/boards` Risk Pulse «Эскалации» открывает scope=`all` по всем активным workspace, показывает доску карточки и открывает задачу через `useTaskNavigator` (с переключением workspace при необходимости).



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
| | SprintCompressedInfo | FlowBoard.tsx | sprint | Sprint progress bar and statistics. Fill uses semantic green `var(--color-signal-green)` consistently with SprintViewSheet; background `var(--color-surface)`. Clickable → opens SprintViewSheet or SprintCreateSheet |
| | TaskViewEdit | TaskViewEdit.tsx | open, onClose, task, mode ('view' \| 'edit'), workers, onSave | Task view/edit 2-in-1 bottom sheet (Figma 1:663 task-create). Single canvas with sections: Ключевой контекст (название, описание, дедлайн через `SingleDateField`/`SingleDateSheet`), Стоимость (SP/CW steppers), Ответственность (соисполнители/наблюдатели), Доп. контекст (чеклист, связанные, зависимые, внешние ссылки — каждый toggle в `Card`, как `SprintActivationCard`). Uses `Segments` (Общее/Комментарии), `SectionHeader`, `Card`, `TextInput`, `TextArea`, `Stepper`, `ToggleSwitch`, `Button`, `SingleDateField`, `SingleDateSheet`. View mode locks fields + solid "Редактировать" button (like BoardViewEdit). Comments tab: the container takes an exact `SHEET_CONTENT_MAX_HEIGHT` and the panel wrapper is `flex min-h-0 flex-1 flex-col` (a row wrapper shrink-wraps the panel to the widest bubble → feed and composer stick to the left edge); the `Segments` header is sticky at `top: SHEET_CHROME_HEIGHT_PX`. |
| | TaskCommentsPanel | TaskCommentsPanel.tsx | taskId, workers, currentUserId | «Комментарии» tab of the task bottom sheet: feed (RPC `get_task_feed`, React Query `['task-feed', taskId]`), optimistic submit, broadcast on `task-comments-<taskId>`. No own horizontal padding — the sheet wrapper (`TaskViewEdit`, `px-4`) provides the 16px inset; feed frame `322:27995` and composer row `322:28018` in Figma are padding 0 (0 is the DS value inside the comments container). First-load state — local `CommentSkeleton` (3 placeholder cards: 32px avatar + bubble, pulse bars `rgba(255,255,255,0.08)`/`0.05`), geometry matches a real comment card (leading-5/leading-4). Review decisions (083/086): comment bubbles with `payload.source==='review'` (helper `isReviewDecision`) get a cyan 1px border `var(--color-signal-cyan)` — same token as the review column accent; covers both fix-reason (083) and approve auto-comment «Результат задачи … согласован» (086). |

**Exports** (`index.ts`): `FlowBoard`, `PersonCard`, `UserAvatar`, `CognitiveWeightIndicator`, `PriorityBadge`, `OnboardingModal`, `SprintCompressedInfo`, `TaskViewEdit`
**Types**: `FlowBoardProps`, `SprintInfo`, `SignalData`, `TaskStatusData`, `WorkerCardData`, `AgentCardData`, `TaskViewEditProps`

---

### settings/ — Settings Page

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | SettingsRow | SettingsRow.tsx | label, value, onClick | Shared settings row using NotchedPanel with chamfered corners |
| | UserProfileCard | UserProfileCard.tsx | username, planName, price, statusLabel | User profile section (avatar, name, plan badge, status) |
| | WorkspaceSettingsCard | WorkspaceSettingsCard.tsx | onMcpClick, onPlansClick, onColleaguesClick | Workspace settings section |
| | OtherSettingsCard | OtherSettingsCard.tsx | language, onLanguageClick, onSupportClick | Other preferences section |
| | CalendarSettingsCard | CalendarSettingsCard.tsx | workspaceId | Calendar integrations section |
| | PlanBadge | PlanBadge.tsx | planName, price | Tariff badge display |

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
| | RelatedTasksSection | RelatedTasksSection.tsx | task, availableTasks, onOpenTask, onTaskStateChange | Always-visible «Связанные задачи» block in TaskViewEdit. Loads direct `blocks` edges, shows blocker progress/downstream impact, opens related tasks and removes/orphan-repairs edges through task-relations API. |
| | RelatedTaskPickerSheet | RelatedTaskPickerSheet.tsx | open, direction, currentTask, tasks, excludedTaskIds, onSelect | Stacked task picker; filters by `full_id`/title and excludes current, done, and already-related tasks. |
| | types | types.ts | — | SprintFormValue, SprintStats type definitions |

**Re-exports** (`index.ts`): `SprintCreateSheet`, `SprintEditSheet`, `SprintViewSheet`, `StatBox`, `Field`, `TasksAccordionRow`, `SprintFormValue`, `SprintStats`

---

### ui/ — Shared UI Primitives

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | BottomSheet | BottomSheet.tsx | open, onClose, children | Slide-up panel with backdrop overlay (portal-based). Panel is the single scroll container (keyboardRide relies on `panel.scrollTop`) and publishes its height ceiling as `--sheet-max-h`; content that must fill exactly the available height (e.g. the task sheet's «Комментарии» tab) uses the exported `SHEET_CONTENT_MAX_HEIGHT` (= `--sheet-max-h` minus the 20px drag-handle chrome) — sticky headers inside the panel keep their position while content scrolls under them. In-sheet sticky headers must pin at the exported `SHEET_CHROME_HEIGHT_PX` (20px = drag-handle chrome: `pt-2` + `h-1` + `pb-2`), never `top-0`: the panel itself is the scroll container and its first child is the handle, so a `top-0` header jumps to the panel's very edge (over the handle) on the first scrolled pixel, while `top: SHEET_CHROME_HEIGHT_PX` keeps it exactly at its resting place. A pinned header carries its own air as padding (`pb-*` + matching negative `-mb-*`), so the container `gap` scrolls inside the opaque header surface instead of leaving a see-through strip. The drag handle itself is sticky + opaque (`top-0`, `z-20`, `bg-[var(--color-surface)]`) — the chrome band (0…20px) is pinned chrome, so scrolled content never shows above a pinned header |
| | DateRangeField | DateRangeField.tsx | startDate, endDate, onOpen, placeholder | Date range display field |
| | DateRangeSheet | DateRangeSheet.tsx | open, onClose, startDate, endDate, onConfirm | BottomSheet with react-day-picker for date range selection |
| | SingleDateField | SingleDateField.tsx | date, onOpen, placeholder, disabled | Single date display field for task deadline |
| | SingleDateSheet | SingleDateSheet.tsx | open, onClose, date, onConfirm, minDate | BottomSheet with Calendar for picking one date |

**Types**: `SprintFormValue` ({ name, startDate, endDate, goal, capacity }), `SprintStats` ({ completedTasks, totalTasks, daysLeft })

---

### ai/ — AI Task Creation

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | TaskCreatorSheet | TaskCreatorSheet.tsx | initData, open, onClose, onTaskCreated, workspaceId | Main task creation bottom sheet with three view modes: 'form' → 'loading' → 'preview'. Contains voice recording with waveform, textarea input, and submit button. Uses ProgressContent for loading state. |
| | ProgressContent | ProgressSheet.tsx | — | Loading indicator with pulsing amber dot and animated stage labels («Распознаю данные…» → «Собираю контекст…» → «Создаю задачу…» → «Почти готово…»). Used inside TaskCreatorSheet at viewMode === 'loading'. |
| | TaskPreviewSheet | TaskCreatorSheet.tsx (internal) | open, taskId, parse, initData, onConfirm, onCancel, onClose | Confirmation/preview of AI-parsed task. Shows editable title, description, priority, deadline, tags, metadata (priority label, deadline, clarity score). |

---

### shared/ — Shared

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| | BottomMenu | BottomMenu.tsx | onCenterClick | Bottom navigation bar. Central button triggers `onCenterClick` or shows fallback notice. "Доска" button toggles between `/flowboard` and `/flowboard?view=stream` when already on flowboard |
| | AiTaskCreator | AiTaskCreator.tsx | — | Global wrapper: BottomMenu + AI task creation overlay (TaskCreatorSheet → ProgressSheet → TaskPreviewSheet). Opens on center button click, refreshes board data after task creation |
| | TelegramInit | TelegramInit.tsx | — | Telegram WebApp init |
| | TelegramProvider | TelegramProvider.tsx | children | Telegram context provider |
| | TelegramTheme | TelegramTheme.tsx | children | Theme provider |
| | TelegramViewportBridge | TelegramViewportBridge.tsx | — | Viewport height bridge |
| | AuthLoader | AuthLoader.tsx | children | Auth loading wrapper |
| | GlobalLoader | GlobalLoader.tsx | ready | Global loading overlay wrapper (fade-out, z-[9999], aria-live). Renders `OnitaskLoader` inside. |
| | OnitaskLoader | OnitaskLoader.tsx | — | Branded splash loader: notched card, traveling amber border glow, logo mark, animated dots. Uses CSS module + design token (--color-signal-yellow for stroke). |
| | OrbitLoader | OrbitLoader.tsx | size (default 40), label, className | Compact in-app loading indicator («orbit»: notched core + glowing amber dot on a rotating track). All geometry is % of `--orbit-size`, so any size keeps proportions (9/5/2px @40px). CSS module; amber = `var(--color-signal-yellow, #f59e0b)`. Replaces text «Загрузка...» while a page/section loads (15 places). |

---

## 3. Figma → Code Mapping

| Figma Node | Component | File | Status |
|------------|-----------|------|--------|
| 1:433 | BottomMenu | BottomMenu.tsx | ✅ |
| 1:913 | BoardForm | CreateDeskForm.tsx | ✅ |
| desk card | BoardCard | BoardCard.tsx | ✅ |
| desk detail | BoardViewEdit | BoardViewEdit.tsx | ✅ (2-in-1 view/edit) |
| task-card | BoardCard | BoardCard.tsx | ✅ |
| risk-pulse | RiskPulse | RiskPulse.tsx | ✅ |
| 98:6093 desks-stream | StreamView | StreamView.tsx | ✅ |

---

*Last updated: 2026-09-16*
