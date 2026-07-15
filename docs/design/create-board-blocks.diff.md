# Design Diff: Create Board — Основное & Функциональное blocks

> **Source Figma:** [dev] ONITASK — node 1:913 (`desk / create`)  
> **Local URL:** http://localhost:3000/create-demo  
> **Date:** 2026-07-15  
> **Scope:** Only two blocks — **Основное** (Board name + slug inputs) and **Функциональное** (Story points toggle + values, Cognitive weight toggle)

---

## 1. Spacing / Цвет / Шрифты

### 1.1. Ширина формы (Form width)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 1 | Main frame `designedWidth: "390px"`, inner content wrapped in `ref-bg-shape-outer` at **358px** width | Форма имеет `max-w-[358px]` (после правки) |
| **Статус** | ✅ Совпадает после правки | |

**Примечание:** Figma показывает outer frame 390px, но все внутренние компоненты (ref-bg-shape-inner/outer) имеют ширину 358px. Текущее значение `max-w-[358px]` корректно.

---

### 1.2. Отступы между секциями (Section gap)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 2 | Main frame `gap: "24px"` между дочерними фреймами (main, func, mates, context, extention, mod) | `<form>` имеет `style={{ gap: '24px' }}` |
| **Статус** | ✅ Совпадает | |

---

### 1.3. Внутренние отступы секций (Section internal padding)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 3 | Каждая секция (например, `EL-93cd89d5` для storypoints) имеет `padding: 12px` | BoardForm использует `p-3` (12px) для контейнеров toggle-секций |
| **Статус** | ✅ Совпадает | |

---

### 1.4. Заголовки секций (Section headings)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 4 | Amber line: `2x18px`, color `#F59E0B`; Text: Inter Display, Medium, 14px, lineHeight 18px, color `#FAFAFA` | BoardHeader: amber line 2x18px `#F59E0B`, text 14px Medium Inter Display `#FAFAFA`, gap-2 (8px) |
| **Статус** | ✅ Совпадает | |

---

### 1.5. Отступ в заголовке toggle-секций (Toggle section header gap)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 5 | Фрейм `EL-9142ef86`: `gap: 8px` между текстом и toggle | BoardForm: `className="flex items-center gap-2"` → Tailwind gap-2 = 8px |
| **Статус** | ✅ Совпадает | |

---

### 1.6. Плейсхолдеры в полях ввода (Input placeholders)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 6 | Placeholder text: color `#8B8B8B` (fill_fa023af3), opacity `0.5`, textStyle `style_e64cf0d5` (16px, Medium, Inter) | До правки: отсутствовал явный стиль плейсхолдера. После правки: добавлен `placeholder:text-text-muted placeholder:opacity-50` |
| **Статус** | ⚠️ Исправлено в этой сессии | `text-text-muted` = `#8B8B8B` из tailwind.config.ts |

---

### 1.7. Размеры шрифтов в Story Points секции

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 7 | Label ("1 SP", "3 SP" и т.д.): `body/14-18 m` → 14px, Medium, lineHeight 18px, color `#FAFAFA` | BoardForm: fontSize 14px, fontWeight 500, lineHeight 18px, color `#FAFAFA` |
| **Статус** | ✅ Совпадает | |
| 8 | Header ("Стоимость сторипоинта"): `style_6bcaa355` → 16px, Medium, Inter Display, letterSpacing -0.0313em, color `#FAFAFA` | BoardForm: fontSize 16px, fontWeight 500, fontFamily Inter Display, letterSpacing -0.0313em, color `#FAFAFA` |
| **Статус** | ✅ Совпадает | |

---

### 1.8. Текст описания когнитивного веса (CW description text)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 9 | `style_6e6ee030`: 12px, Regular (400), Inter, lineHeight 16px, letterSpacing -0.0417em, color `#8B8B8B` | BoardForm: `text-text-muted mb-3` + inline style fontSize 12px, fontWeight 400, lineHeight 16px, letterSpacing -0.0417em, color `#8B8B8B` |
| **Статус** | ✅ Совпадает | |

---

### 1.9. Отступ между строками SP значений (SP value rows gap)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 10 | Фрейм `EL-bc40306a`: `gap: 8px`; внутренний фрейм `EL-cf7afb66`: `gap: 6px` между label+input | BoardForm: `className="space-y-1.5"` → Tailwind space-y-1.5 = 6px |
| **Статус** | ✅ Совпадает | |

---

## 2. Состояния (States)

### 2.1. Toggle состояние по умолчанию (Default toggle state)

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 11 | Figma показывает toggle в активном состоянии (`componentSetId: 22:5993`, `is-active=true`), nail сдвинут вправо | BoardForm: `spEnabled` defaults to `true`, `cwEnabled` defaults to `true` |
| **Статус** | ✅ Исправлено | SP toggle включён по умолчанию. CW toggle также включён по умолчанию (исправлено в соответствии с Figma node 337:28043 `is-active=true`) |

---

### 2.2. Disabled state инпутов SP значений

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 12 | В Figma нет явного disabled-состояния для инпутов SP | BoardForm: `disabled={!spEnabled}` + `disabled:opacity-50` |
| **Статус** | ℹ️ Расширение логики | Disabled state реализован через opacity |

---

### 2.3. Gradient border у инпутов SP значений

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 13 | Figma использует компонент `input-field-s` (componentSetId: 7:8086) с gradient border: `linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)`, strokeWeight 1px | BoardForm: используется обёртка с gradient background shape + padding `10px 12px`, идентичная паттерну из `TextInput` компонента |
| **Статус** | ✅ Исправлено | Gradient border реализован через `SP_INPUT_GRADIENT_STYLE` константу с maskComposite/exclude паттерном |

**Исправленная реализация (BoardForm.tsx):**
```tsx
const SP_INPUT_GRADIENT_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
  borderRadius: '4px',
  mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  maskComposite: 'exclude',
  WebkitMaskComposite: 'xor',
  padding: '1px',
};
// Обёртка: <div className="relative flex-1"> → gradient shape → <div style={{ padding: '10px 12px' }}> → <input />
```

---

### 2.4. Размер инпутов SP значений

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 14 | input-field-s: padding `10px 12px`, высота определяется контентом (sizing vertical: hug) | BoardForm: обёртка с `padding: '10px 12px'`, высота определяется контентом + padding |
| **Статус** | ✅ Исправлено | Убрана фиксированная `h-8`, используется padding-based sizing через обёртку `<div style={{ padding: '10px 12px' }}>` |

---

## 3. Responsive поведение

### 3.1. Адаптивность основного фрейма

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 15 | Main frame sizing: `horizontal: "contextual"`, `vertical: "hug"`, designedWidth: `390px`. Внутренние элементы: `alignSelf: stretch`, `horizontal: fill` | BoardForm: `max-w-[358px] w-full mx-auto` — ограничено 358px, растягивается на всю ширину до лимита |
| **Статус** | ✅ Совпадает | Content width 358px соответствует внутренним компонентам Figma (ref-bg-shape-outer width: 358px) |

---

### 3.2. Поведение при уменьшении ширины

| # | Ожидание (Figma) | Факт (текущая реализация) |
|---|---|---|
| 16 | Figma не определяет явных breakpoint'ов. Все элементы имеют `alignSelf: stretch` или `horizontal: fill` | BoardForm: `w-full max-w-[358px]` — растягивается на мобильных, ограничивается на десктопе. `overflow-y-auto` для скролла |
| **Статус** | ✅ Совпадает | |

---

## Итоговая таблица расхождений

| # | Категория | Описание | Статус | Приоритет |
|---|---|---|---|---|
| 1 | Spacing | Ширина формы — была 390px, стало 358px | ✅ Исправлено | — |
| 2 | Spacing | Gap между секциями 24px | ✅ Совпадает | — |
| 3 | Spacing | Padding секций 12px | ✅ Совпадает | — |
| 4 | Spacing/Шрифты | Заголовки секций (amber line + text) | ✅ Совпадает | — |
| 5 | Spacing | Gap в header toggle-секций 8px | ✅ Совпадает | — |
| 6 | Шрифты/Цвет | Placeholder styling | ✅ Исправлено в этой сессии | — |
| 7 | Шрифты | SP labels typography | ✅ Совпадает | — |
| 8 | Шрифты | SP header typography | ✅ Совпадает | — |
| 9 | Шрифты/Цвет | CW description typography | ✅ Совпадает | — |
| 10 | Spacing | Gap между SP rows 6px | ✅ Совпадает | — |
| 11 | States | Toggle default state (CW) | ✅ Исправлено | — |
| 12 | States | Disabled state SP inputs | ℹ️ Расширение | — |
| 13 | Состояния | Gradient border у SP инпутов | ✅ Исправлено | Высокий |
| 14 | Spacing | Высота SP инпутов | ✅ Исправлено | Низкий |
| 15 | Responsive | Width constraint | ✅ Совпадает | — |
| 16 | Responsive | Adaptive behavior | ✅ Совпадает | — |

---

## Рекомендации

Все рекомендации выполнены и исправления применены:

1. ✅ **Высокий приоритет (#13):** Gradient border реализован через `SP_INPUT_GRADIENT_STYLE` константу.
2. ✅ **Низкий приоритет (#11):** CW toggle установлен в `true` по умолчанию.
3. ✅ **Низкий приоритет (#14):** Фиксированная `h-8` заменена на padding-based sizing.

---
*Создано на основе анализа Figma node 1:913 и исходного кода `src/components/board/BoardForm.tsx`, `src/components/board/TextInput.tsx`, `src/components/board/Header.tsx`.  
Последнее обновление: 2026-07-15 — все расхождения исправлены.*