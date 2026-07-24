# Component Map — Onitask Design System

## Overview
This document maps Figma components to their code implementations in the Onitask project.
All components use design tokens from `src/styles/tokens.css` (no hardcoded hex values).

**Maintenance Rule**: When adding/modifying components, update this file immediately. See `.clinerules/.clinerules` § Front-End & Figma Code Generation Rules.

---

## 1. UI Kit (Atomic) — `src/components/ui/desk-ui/`

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| Button | Button.tsx | variant, corner, disabled, className | Solid/outline button |
| Card | Card.tsx | children, className | Basic container |
| NotchedPanel | NotchedPanel.tsx | corner, radius, notch, borderWidth, borderGradient, border, fill, contentClassName | Panel with chamfered corners |
| SectionHeader | SectionHeader.tsx | title | Section title with amber accent bar |
| Stepper | Stepper.tsx | value, min, max, onChange, unitLabel, borderGradient | Number stepper with gradient border |
| TextInput | TextInput.tsx | value, onChange, placeholder, disabled | Text input field |
| TextArea | TextArea.tsx | value, onChange, placeholder, disabled | Multiline text input |
| ToggleSwitch | ToggleSwitch.tsx | checked, onChange, label | On/off toggle |
| CountBadge | CountBadge.tsx | count | Number badge |

---

## 2. Feature Components

### board/ — Boards

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| BoardCard | BoardCard.tsx | data, onClick, isActive, isSelected, onSelect | Board card in list |
| BoardDetail | BoardDetail.tsx | boardName, slug, sprint, sprintTasks, colleagues, externalLinks, documents, deadlineWarningDays, boardSettings, loading | Board detail view |
| RiskPulse | RiskPulse.tsx | data | Risk indicators grid |
| WorkspaceWizard | WorkspaceWizard.tsx | — | Workspace setup wizard |

**Types**: `BoardCardData`, `BoardStats`, `SprintInfo`, `BoardDetailProps`, `WorkerCardData`, `ExternalLinkData`, `DocumentData`

---

### desk-create/ — Board Creation/Editing

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| CreateDeskForm | CreateDeskForm.tsx | onSubmit, onAddColleague | Board creation form |
| EditDeskForm | EditDeskForm.tsx | workspaceId, initialData, onAddColleague | Board editing form |
| BasicInfoSection | BasicInfoSection.tsx | name, slug, onNameChange, onSlugChange, disabled | Name + @desk input |
| StoryPointCostCard | StoryPointCostCard.tsx | enabled, onEnabledChange, hoursBySp, onHoursChange | SP cost config |
| CognitiveWeightCard | CognitiveWeightCard.tsx | enabled, onEnabledChange | Cognitive weight toggle |
| CoworkingSection | CoworkingSection.tsx | colleagueCount, onAddColleague | Colleagues section |
| ContextSection | ContextSection.tsx | value, onChange | Context textarea |
| DocumentsCard | DocumentsCard.tsx | enabled, onEnabledChange, files, onFilesChange | File upload |
| ExternalLinksCard | ExternalLinksCard.tsx | enabled, onEnabledChange, links, onLinksChange | External links |
| TrafficLightCard | TrafficLightCard.tsx | enabled, warningDays, urgentDays, onWarningDaysChange, onUrgentDaysChange | Deadline signals |

**Types**: `CreateDeskFormValue`, `EditDeskFormValue`, `ExternalLink`

---

### calendar/ — Calendar

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| CalendarView | CalendarView.tsx | — | Main calendar view |
| CalendarTabs | CalendarTabs.tsx | — | Calendar tab navigation |
| DayView | DayView.tsx | — | Day view |
| ThreeDaysView | ThreeDaysView.tsx | — | 3-day view |
| MonthListView | MonthListView.tsx | — | Month list view |
| ListView | ListView.tsx | — | List view |

---

### flowboard/ — Flow Board

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| FlowBoard | FlowBoard.tsx | — | Main flow board |
| TaskForm | TaskForm.tsx | — | Task creation/edit form |
| UrgencyBadge | UrgencyBadge.tsx | — | Urgency indicator |
| OnboardingModal | OnboardingModal.tsx | — | Onboarding modal |

---

### shared/ — Shared

| Component | File | Key Props | Purpose |
|-----------|------|-----------|---------|
| BottomMenu | BottomMenu.tsx | — | Bottom navigation bar |
| TelegramInit | TelegramInit.tsx | — | Telegram WebApp init |
| TelegramProvider | TelegramProvider.tsx | children | Telegram context provider |
| TelegramTheme | TelegramTheme.tsx | children | Theme provider |
| TelegramViewportBridge | TelegramViewportBridge.tsx | — | Viewport height bridge |
| AuthLoader | AuthLoader.tsx | children | Auth loading wrapper |
| GlobalLoader | GlobalLoader.tsx | — | Global loading spinner |

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

---

*Last updated: 2026-07-24*