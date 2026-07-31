# Аудит: Sprint Create Sheet — Figma vs Implementation

**Дата:** 2026-07-31
**Figma node:** `240:25518` ("current-sprint / create")
**Глубина:** 5
**Эталон:** [Figma — dev ONITASK](https://www.figma.com/design/EhjoAgxmDSPu7jsuUEXl46/-dev--ONITASK?node-id=240-25518)

---

## Структура Figma-эталона

```
bottom-sheet (instance 210:21251)
├── close-area (backdrop, fill, fill)
└── bs-container (column, padding: 24px 16px 32px, gap: 16px, width: 390px)
    ├── content SLOT (column, gap: 24px, stretch, fill/hug)
    │   ├── header FRAME (row, gap: 8px, center)
    │   │   └── TEXT "Создание спринта"
    │   │       (Inter Display Medium 500, 20px, lh 24px, ls -0.025em, #FFFFFF)
    │   ├── form FRAME (column, gap: 20px, stretch, fill/hug)
    │   │   ├── Field "Название спринта" (EL-cf7afb66, gap: 6px)
    │   │   │   ├── TEXT label (Inter Medium 500, 14px, lh 18px, ls -0.0357em, #8B8B8B)
    │   │   │   └── input-field-s (is-filled=false, padding: 10px 12px)
    │   │   ├── Field "Даты спринта"
    │   │   │   ├── TEXT label (same)
    │   │   │   └── input-field-s (is-filled=false, trailing-icon=true)
    │   │   ├── Field "Цель спринта"
    │   │   │   ├── TEXT label (same)
    │   │   │   └── text-area-s (is-filled=false, padding: 10px 12px, radius: 6px)
    │   │   ├── Field "Ёмкость спринта"
    │   │   │   ├── TEXT label (same)
    │   │   │   └── input-field-s (is-filled=true)
    │   │   └── sprint-tasks (opened=false, has-tasks=false)
    │   │       ├── header (row, padding: 12px, space-between, center)
    │   │       └── ref-bg-shape-outer (absolute, 358×48)
    │   └── button-section FRAME (column, gap: 12px, stretch, fill/hug)
    │       └── button-prim-s (height: 40px, padding: 0px 16px, label="Создать спринт")
    └── ref-bg-shape-bottomsheet (absolute, 390×552)
```

---

## Сравнение с реализацией

### 🔴 КРИТИЧЕСКИЕ (структурные/семантические)

| # | Элемент | Figma | Реализация | Файл | Статус |
|---|---------|-------|------------|------|--------|
| 1 | **"Цель спринта" — тип поля** | `text-area-s` (многострочный) | `TextInput` (однострочный) | `SprintCreateSheet.tsx:63` | ❌ Несоответствие |
| 2 | **Gap-структура контента** | 3 уровня: content (gap 24px) → form (gap 20px) → button-section (gap 12px) | Один плоский `gap-5` (20px) для всех | `SprintCreateSheet.tsx:40` | ❌ Нарушена иерархия |
| 3 | **DateRangeField — визуальная система** | `input-field-s` (NotchedPanel) | Кастомный `<button>` с `rounded-[6px] border border-[rgba(255,255,255,0.2)] bg-[#161616]` | `DateRangeField.tsx:26` | ❌ Вне дизайн-системы |
| 4 | **TasksAccordionRow — визуальная система** | `sprint-tasks` компонент с `ref-bg-shape-outer` (358×48) | `border-t border-line pt-4` — простая линия | `TasksAccordionRow.tsx:20` | ❌ Не соответствует |

### 🟠 ВАЖНЫЕ (значения отступов/типографики)

| # | Элемент | Figma | Реализация | Файл | Статус |
|---|---------|-------|------------|------|--------|
| 5 | **Container bottom padding** | `32px` | `pb-6` = 24px | `SprintCreateSheet.tsx:40` | ❌ Должно быть `pb-8` |
| 6 | **Заголовок — font-size** | `20px` | `text-[19px]` | `SprintCreateSheet.tsx:41` | ❌ Должно быть `text-[20px]` |
| 7 | **Заголовок — font-family** | `Inter Display` | `font-medium` (Inter) | `SprintCreateSheet.tsx:41` | ❌ Нет `font-display` |
| 8 | **Заголовок — color** | `#FFFFFF` | `text-text` = `#f2f2f0` | `SprintCreateSheet.tsx:41` | ❌ Не точно |
| 9 | **Заголовок — lineHeight** | `24px` | не задан | `SprintCreateSheet.tsx:41` | ❌ Отсутствует |
| 10 | **Заголовок — letterSpacing** | `-0.025em` | не задан | `SprintCreateSheet.tsx:41` | ❌ Отсутствует |
| 11 | **Label — font-size** | `14px` | `text-[13px]` | `Field.tsx:16` | ❌ Должно быть `text-sm` (14px) |
| 12 | **Label — lineHeight** | `18px` | не задан | `Field.tsx:16` | ❌ Отсутствует |
| 13 | **Label — letterSpacing** | `-0.0357em` | не задан | `Field.tsx:16` | ❌ Отсутствует (есть `tracking-tighter` в config) |
| 14 | **Input — horizontal padding** | `12px` | `px-4` = 16px | `TextInput.tsx:46` | ❌ Должно быть `px-3` (12px) |
| 15 | **TextArea — horizontal padding** | `12px` | `px-4` = 16px | `TextArea.tsx:44` | ❌ Должно быть `px-3` (12px) |
| 16 | **DateRangeField — padding** | `10px 12px` | `px-4 py-3` = 16px 12px | `DateRangeField.tsx:26` | ❌ Горизонталь 16px вместо 12px |
| 17 | **BottomSheet backdrop** | `rgba(10, 10, 10, 0.8)` | `bg-black/60` = 60% | `BottomSheet.tsx:56` | ❌ Должно быть 80% |
| 18 | **Gap между header → form** | `24px` (content gap) | `20px` (gap-5) | `SprintCreateSheet.tsx:40` | ❌ Должно быть `gap-6` (24px) |
| 19 | **Gap между form → button** | `24px` (content gap) | `20px` (gap-5) | `SprintCreateSheet.tsx:40` | ❌ Должно быть `gap-6` (24px) |

### 🟡 МИНОРНЫЕ (косметические/допущения)

| # | Элемент | Figma | Реализация | Файл | Статус |
|---|---------|-------|------------|------|--------|
| 20 | **Drag handle** | Отсутствует в эталоне | Есть (`w-10 h-1 rounded-full`) | `BottomSheet.tsx:75-79` | ⚠️ Доп. UX-элемент |
| 21 | **Input height** | `hug` (контент, ~38px) | `h-10` = 40px (fixed) | `TextInput.tsx:28` | ⚠️ Допустимое допущение |
| 22 | **Button height** | `40px` | `h-10` = 40px | `Button.tsx:25` | ✅ Совпадает |
| 23 | **Field label → input gap** | `6px` (EL-cf7afb66 gap) | `mb-1.5` = 6px | `Field.tsx:16` | ✅ Совпадает |
| 24 | **Button label** | `"Создать спринт"` | `"Создать спринт"` | `SprintCreateSheet.tsx:84` | ✅ Совпадает |
| 25 | **BottomSheet radius** | SVG-shape (визуально ~16px) | `rounded-t-2xl` + inline `16px` | `BottomSheet.tsx:66-72` | ✅ Совпадает |
| 26 | **"Ёмкость спринта" — variant** | `is-filled=true` | Обычный `TextInput` | `SprintCreateSheet.tsx:71` | ⚠️ Нет filled-состояния |

---

## Анализ относительных значений (адаптивность)

Пользователь указал, что в ДС используются **только относительные значения** для корректности адаптивной вёрстки.

### ✅ Корректные относительные значения

| Компонент | Класс | Значение | Тип |
|-----------|-------|----------|-----|
| Container gap | `gap-5` | `1.25rem` (20px) | rem ✅ |
| Container padding X | `px-4` | `1rem` (16px) | rem ✅ |
| Container padding top | `pt-6` | `1.5rem` (24px) | rem ✅ |
| Label margin | `mb-1.5` | `0.375rem` (6px) | rem ✅ |
| Button height | `h-10` | `2.5rem` (40px) | rem ✅ |
| Input height | `h-10` | `2.5rem` (40px) | rem ✅ |

### ❌ Хардкод-значения (нарушение ДС)

| Компонент | Класс/Style | Значение | Проблема | Файл |
|-----------|-------------|----------|----------|------|
| Заголовок | `text-[19px]` | `19px` | Fixed px, должно быть `text-[1.25rem]` или `text-xl` | `SprintCreateSheet.tsx:41` |
| Label | `text-[13px]` | `13px` | Fixed px, должно быть `text-[0.875rem]` или `text-sm` | `Field.tsx:16` |
| TasksAccordion title | `text-[15px]` | `15px` | Fixed px | `TasksAccordionRow.tsx:27` |
| TasksAccordion task id | `text-[14px]` | `14px` | Fixed px | `TasksAccordionRow.tsx:89` |
| TasksAccordion task title | `text-[12px]` | `12px` | Fixed px | `TasksAccordionRow.tsx:90` |
| DateRangeField | `text-[15px]` | `15px` | Fixed px | `DateRangeField.tsx:26` |
| DateRangeField bg | `bg-[#161616]` | Hex | Хардкод цвета вне токенов | `DateRangeField.tsx:26` |
| DateRangeField border | `border-[rgba(255,255,255,0.2)]` | RGBA | Хардкод цвета вне токенов | `DateRangeField.tsx:26` |
| DateRangeField text | `text-[#FAFAFA]` | Hex | Хардкод цвета | `DateRangeField.tsx:31` |
| DateRangeField text | `text-[#8B8B8B]` | Hex | Хардкод цвета (есть токен `text-muted`) | `DateRangeField.tsx:31` |
| BottomSheet radius | `borderTopLeftRadius: '16px'` | Inline px | Inline style, fixed px | `BottomSheet.tsx:70-71` |
| BottomSheet bg | `bg-[var(--color-bg-surface,#1A1A1A)]` | Inline var | Inline style вместо Tailwind-класса | `BottomSheet.tsx:66` |

---

## Рекомендации по исправлению

### Приоритет 1 — Структурные

1. **`SprintCreateSheet.tsx`**: Заменить `TextInput` на `TextArea` для поля "Цель спринта"
2. **`SprintCreateSheet.tsx`**: Восстановить 3-уровневую gap-иерархию:
   ```tsx
   <div className="flex flex-col gap-6 px-4 pb-8 pt-6">
     <h2 className="font-display text-[1.25rem] leading-6 tracking-[-0.025em] text-white">
       Создание спринта
     </h2>
     <div className="flex flex-col gap-5">
       {/* fields */}
     </div>
     <div className="flex flex-col gap-3">
       <Button variant="solid" disabled={!canSubmit} onClick={handleSubmit}>
         Создать спринт
       </Button>
     </div>
   </div>
   ```
3. **`DateRangeField.tsx`**: Переписать на `NotchedPanel` + `TextInput`-подобную структуру, убрать хардкод-цвета
4. **`TasksAccordionRow.tsx`**: Заменить `border-t` на `NotchedPanel` с `ref-bg-shape-outer`

### Приоритет 2 — Типографика

5. **`Field.tsx`**: `text-[13px]` → `text-sm` (14px), добавить `leading-[1.125rem] tracking-tighter`
6. **`SprintCreateSheet.tsx`**: `text-[19px]` → `text-[1.25rem]` (20px), добавить `font-display leading-6 tracking-[-0.025em] text-white`

### Приоритет 3 — Отступы

7. **`TextInput.tsx`**: `px-4` → `px-3` (12px)
8. **`TextArea.tsx`**: `px-4` → `px-3` (12px)
9. **`SprintCreateSheet.tsx`**: `pb-6` → `pb-8` (32px)
10. **`BottomSheet.tsx`**: `bg-black/60` → `bg-black/80`

### Приоритет 4 — Относительные значения

11. Заменить все `text-[Npx]` на rem-эквиваленты или Tailwind-классы из `tailwind.config.ts`
12. Убрать inline styles в `BottomSheet.tsx`, использовать Tailwind-классы
13. Убрать хардкод-цвета в `DateRangeField.tsx`, использовать токены (`text-muted`, `surface`, `line`)

---

## Сводка

| Категория | Всего | ✅ Совпадает | ❌ Несоответствие | ⚠️ Допущение |
|-----------|-------|-------------|-------------------|-------------|
| Структура | 4 | 0 | 4 | 0 |
| Типографика | 6 | 0 | 6 | 0 |
| Отступы | 5 | 1 | 4 | 0 |
| Цвета | 3 | 0 | 3 | 0 |
| Адаптивность | 13 | 6 | 7 | 0 |
| Доп. элементы | 5 | 3 | 0 | 2 |
| **Итого** | **36** | **10** | **24** | **2** |

**Общий процент соответствия: ~28%**

Основные проблемы:
1. Поле "Цель спринта" использует `TextInput` вместо `TextArea`
2. `DateRangeField` написан вне дизайн-системы (хардкод-цвета, не NotchedPanel)
3. `TasksAccordionRow` не использует `ref-bg-shape-outer`
4. Множественные нарушения типографики (размеры, семейства, lineHeight, letterSpacing)
5. Хардкод px-значений вместо rem-эквивалентов
6. Нарушена gap-иерархия (плоская структура вместо 3-уровневой)