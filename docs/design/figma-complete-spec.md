# ONITASK — Полная спецификация Figma макета

> **File Key:** `EhjoAgxmDSPu7jsuUEXl46`
> **Экспортировано:** 2026-07-20
> **Назначение:** Единый документ для передачи агенту (без доступа к Figma)

---

## 1. ОБЩАЯ ИНФОРМАЦИЯ

### 1.1 Проект
- **Название:** [dev] ONITASK
- **Страница:** WIP
- **Размер экрана:** 390 × 844 px (iPhone)
- **Тема:** Тёмная

### 1.2 Экраны (7 шт.)

| # | Экран | ID | Описание |
|---|-------|-----|----------|
| 1 | start | `64:83023` | Стартовый экран с логотипом и кнопкой "Начать" |
| 2 | desk / create | `65:83023` | Создание доски (форма) |
| 3 | desk [empty] | — | Пустая доска |
| 4 | desk-flow | `1:445` | Flow board с карточками задач и сигналами |
| 5 | desks-stream | — | Стрим всех досок |
| 6 | desk / [desk_UUID] / edit | `1:836` | Настройки доски |
| 7 | desk / task / view | — | Просмотр задачи |
| 8 | desk / task / create | — | Создание задачи |

---

## 2. DESIGN TOKENS

### 2.1 Цвета

| Токен | Значение | Применение |
|-------|----------|------------|
| `--bg-primary` | `#0A0A0A` | Основной фон экрана |
| `--bg-surface` | `#101010` | Фон карточек/секций |
| `--bg-card` | `#161616` | Фон элементов внутри секций |
| `--text-primary` | `#8B8B8B` | Основной текст (серый) |
| `--text-secondary` | `#FAFAFA` | Заголовки, акцентный текст (белый) |
| `--accent` | `#0FEE9E` | Акцентный зелёный (кнопки, активные состояния) |
| `--accent-yellow` | `#F59E0B` | Жёлтая линия заголовка "Основное" |
| `--border` | `rgba(255, 255, 255, 0.2)` | Границы элементов |
| `--border-light` | `rgba(0, 0, 0, 0.05)` | Лёгкие границы |
| `--black` | `#000000` | Чёрный |

### 2.2 Typography

| Стиль | Font Family | Weight | Size | Line Height | Letter Spacing | Применение |
|-------|-------------|--------|------|-------------|----------------|------------|
| `body/16-20 sb` | Inter | Semi Bold (600) | 16px | 20px | -0.0313em | Кнопки, label |
| `body/14-18 m` | Inter Display | Medium (500) | 14px | 18px | -0.0357em | Заголовки секций |
| `body/12-14 m` | Inter Display | Medium (500) | 12px | 14px | -0.0417em | Hint text, badge |
| `body/14-18 r` | Inter | Regular (400) | 14px | 18px | — | Основной текст |
| `body/12-16 r` | Inter | Regular (400) | 12px | 16px | — | Вспомогательный текст |

### 2.3 Layout & Spacing

| Параметр | Значение |
|----------|----------|
| Screen | 390 × 844 px |
| Padding (screen) | 16px |
| Gap между секциями | 24px |
| Gap внутри секции | 12px |
| Gap между элементами в строке | 8px |
| Border-radius (карточки) | 12px |
| Border-radius (инпуты) | 6px |
| Border-radius (кнопки) | 999px (pill) |
| Border-radius (badge) | 999px (pill) |

---

## 3. КОМПОНЕНТЫ (полная спецификация)

### 3.1 button-prim-m (Primary Medium)
- **ID:** `7:6302`
- **Высота:** 48px
- **Padding:** 12px
- **Border-radius:** 999px
- **Background:** `#0FEE9E` (accent)
- **Text:** Inter Semi Bold 16px/20px, `#000000`
- **Свойства:**
  - `show leading-icon` (boolean, default: true)
  - `show trailing-icon` (boolean, default: true)
  - `label` (text, default: "Кнопка")
- **Состояния:** default, hover, pressed

### 3.2 button-prim-s (Primary Small)
- **ID:** `7:7369`
- **Высота:** 40px
- **Padding:** 10px 16px
- **Border-radius:** 999px
- **Background:** `#0FEE9E` (accent)
- **Text:** Inter Semi Bold 14px/18px, `#000000`
- **Свойства:**
  - `show leading-icon` (boolean, default: true)
  - `show trailing-icon` (boolean, default: true)
  - `label` (text, default: "Кнопка")

### 3.3 button-sec-s (Secondary Small)
- **ID:** `7:8172`
- **Высота:** 40px
- **Padding:** 10px 16px
- **Border-radius:** 999px
- **Background:** transparent
- **Border:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Text:** Inter Semi Bold 14px/18px, `#FAFAFA`
- **Свойства:**
  - `show leading-icon` (boolean, default: true)
  - `show trailing-icon` (boolean, default: true)
  - `label` (text, default: "Кнопка")

### 3.4 input-field-m (Input Medium)
- **ID:** `7:7734`
- **Высота:** 48px
- **Border-radius:** 6px
- **Background:** `#161616`
- **Border:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Padding:** 12px 16px
- **Text:** Inter Medium 16px/20px, `#FAFAFA`
- **Placeholder:** Inter Medium 16px/20px, `#8B8B8B`
- **Свойства:**
  - `leading-icon` (boolean, default: false)
  - `trailing-icon` (boolean, default: false)

### 3.5 input-field-s (Input Small)
- **ID:** `7:8086`
- **Высота:** 40px
- **Border-radius:** 6px
- **Background:** `#161616`
- **Border:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Padding:** 8px 12px
- **Text:** Inter Medium 14px/18px, `#FAFAFA`
- **Placeholder:** Inter Medium 14px/18px, `#8B8B8B`
- **Свойства:**
  - `leading-icon` (boolean, default: false)
  - `trailing-icon` (boolean, default: false)

### 3.6 text-area-m (Textarea Medium)
- **ID:** `83:17453`
- **Высота:** 80px (min)
- **Border-radius:** 6px
- **Background:** `#161616`
- **Border:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Padding:** 12px 16px
- **Text:** Inter Medium 16px/20px, `#FAFAFA`
- **Placeholder:** Inter Medium 16px/20px, `#8B8B8B`
- **Свойства:**
  - `leading-icon` (boolean, default: false)
  - `trailing-icon` (boolean, default: false)

### 3.7 toggle
- **ID:** `22:5993`
- **Высота:** 28px
- **Ширина:** 48px
- **Border-radius:** 999px
- **Background (off):** `#161616`
- **Background (on):** `#0FEE9E`
- **Thumb:** 24px circle, `#FAFAFA`
- **Свойства:**
  - `is-active` (boolean, default: false)

### 3.8 badge
- **ID:** `17:8819`
- **Высота:** 24px
- **Padding:** 4px 10px
- **Border-radius:** 999px
- **Background:** `#161616`
- **Border:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Text:** Inter Display Medium 12px/14px, `#8B8B8B`
- **Свойства:**
  - `text` (text, default: "Текст")

### 3.9 counter
- **ID:** `424:32469`
- **Высота:** 40px
- **Border-radius:** 6px
- **Background:** `#161616`
- **Border:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Структура:** `[−] value [+]`
- **Кнопки:** 32×32px, border-radius 6px, `#101010`
- **Text:** Inter Semi Bold 16px/20px, `#FAFAFA`

### 3.10 task-card
- **ID:** `10:10763`
- **Border-radius:** 12px
- **Background:** `#161616`
- **Padding:** 12px
- **Свойства:**
  - `has-svetofor` (boolean, default: false) — светофор приоритета
  - `show-status` (boolean, default: true) — показывать статус
- **Внутренняя структура:**
  - Заголовок задачи (Inter Semi Bold 14px/18px, `#FAFAFA`)
  - Описание (Inter Regular 12px/16px, `#8B8B8B`)
  - Нижняя строка: assignee avatar + CW indicator + deadline

### 3.11 cognitive-weight-indicator (CW)
- **ID:** `167:22591`
- **Варианты:**
  - `weight=0` — скрыт/пусто
  - `weight=1` — низкий (зелёный)
  - `weight=2` — средний (жёлтый)
  - `weight=3` — высокий (красный)
- **Размер:** 16×16px
- **Форма:** круг

### 3.12 Header (iOS)
- **ID:** `1:57`
- **Высота:** 44px (стандартный iOS status bar)
- **Содержит:** время, батарея, Wi-Fi

### 3.13 buttom-menu (Bottom Navigation)
- **ID:** `1:433`
- **Высота:** 64px
- **Background:** `#101010`
- **Border-top:** 1px solid `rgba(255, 255, 255, 0.2)`
- **Пункты меню:** 4-5 иконок с label

### 3.14 bottom-sheet
- **ID:** `210:21251`
- **Border-radius:** 24px (top)
- **Background:** `#101010`
- **Handle:** 32×4px, `rgba(255, 255, 255, 0.2)`, border-radius 2px

### 3.15 Screen
- **ID:** `3:3999`
- **Размер:** 390 × 844 px
- **Background:** `#0A0A0A`

---

## 4. ЭКРАН: start (Стартовый)

**ID:** `64:83023`

```
┌──────────────────────┐
│     Header (iOS)      │ 44px
├──────────────────────┤
│                      │
│       [logo]         │ 200×200px
│     (center)         │
│                      │
│   ┌──────────────┐   │
│   │    Начать     │   │ button-prim-m, 48px
│   └──────────────┘   │
│                      │
├──────────────────────┤
│    buttom-menu       │ 64px
└──────────────────────┘
```

**Элементы:**
- `logo` (INSTANCE) — 200×200px, center
- `button-prim-m` — label: "Начать", full width (358px = 390 - 16×2)

---

## 5. ЭКРАН: desk / create (Создание доски)

**ID:** `65:83023` (контент), `65:7715` (полный экран)

### 5.1 Структура

```
┌──────────────────────────────┐
│        Header (iOS)           │
├──────────────────────────────┤
│                              │
│  ── Основное ──────────────  │ ← yellow line: #F59E0B
│  ┌────────────────────────┐  │
│  │ Название доски         │  │ input-field-m
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ @desk                  │  │ input-field-m
│  └────────────────────────┘  │
│                              │
│  ── Функциональное ────────  │
│  ┌─ toggle ─────────────────┐│
│  │ Стоимость сторипоинта    ││ toggle (is-active)
│  └──────────────────────────┘│
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │ 1 SP │ │1 час │ │ 3 SP │ │ input-field-s (3 в ряд)
│  └──────┘ └──────┘ └──────┘ │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │ 5 SP │ │ 7 SP │ │13 SP │ │ input-field-s (3 в ряд)
│  └──────┘ └──────┘ └──────┘ │
│  ┌─ toggle ─────────────────┐│
│  │ Когнитивный вес          ││ toggle
│  └──────────────────────────┘│
│  Описание CW...              │ text (14px, #8B8B8B)
│                              │
│  ── Коворкинг ─────────────  │
│  [0 коллег]                  │ badge
│  [Добавить коллегу]          │ button-sec-s
│                              │
│  ── Контекст доски ────────  │
│  ┌────────────────────────┐  │
│  │ Краткое описание       │  │ text-area-m
│  └────────────────────────┘  │
│                              │
│  ── Дополнительные материалы  │
│  ┌─ toggle ─────────────────┐│
│  │ Документы                ││ toggle
│  └──────────────────────────┘│
│  ┌────────────────────────┐  │
│  │ Выберите файл          │  │ input-field-s (file picker)
│  └────────────────────────┘  │
│  до 10 документов...         │ hint text (12px, #8B8B8B)
│  [Добавить .md файл]         │ button-sec-s
│  ┌─ toggle ─────────────────┐│
│  │ Внешние ссылки           ││ toggle
│  └──────────────────────────┘│
│  ┌────────────────────────┐  │
│  │ Название ресурса       │  │ input-field-s
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │ Ссылка                 │  │ input-field-s
│  └────────────────────────┘  │
│  [Добавить ссылку]           │ button-sec-s
│                              │
│  ── Модификации ──────────  │
│  [−] 1 день [+]             │ counter
│  [−] 3 дня [+]              │ counter
│                              │
│  ┌────────────────────────┐  │
│  │     Создать доску      │  │ button-prim-s, full width
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│        buttom-menu           │
└──────────────────────────────┘
```

### 5.2 Секции (детально)

#### Секция "Основное"
- **Заголовок:** "Основное", Inter Display Medium 14px/18px, `#FAFAFA`
- **Yellow line:** 2px высота, `#F59E0B`, width auto
- **Поля:**
  - `input-field-m` — placeholder: "Название доски"
  - `input-field-m` — placeholder: "@desk"

#### Секция "Функциональное"
- **Заголовок:** "Функциональное"
- **Toggle "Стоимость сторипоинта"** — включает 6 полей SP
- **6× `input-field-s`** в 2 ряда по 3:
  - Ряд 1: "1 SP", "1 час", "3 SP"
  - Ряд 2: "5 SP", "7 SP", "13 SP"
- **Toggle "Когнитивный вес"** — включает описание
- **Описание:** "Когнитивный вес — это...", Inter Regular 14px/18px, `#8B8B8B`

#### Секция "Коворкинг"
- **Заголовок:** "Коворкинг"
- **badge:** "0 коллег"
- **button-sec-s:** "Добавить коллегу"

#### Секция "Контекст доски"
- **Заголовок:** "Контекст доски"
- **text-area-m:** placeholder "Краткое описание"

#### Секция "Дополнительные материалы"
- **Заголовок:** "Дополнительные материалы"
- **Подсекция "Документы":**
  - toggle "Документы"
  - input-field-s (file picker)
  - hint: "до 10 документов, до 5мегабайт в сумме, формат .md"
  - button-sec-s: "Добавить .md файл"
- **Подсекция "Внешние ссылки":**
  - toggle "Внешние ссылки"
  - input-field-s: "Название ресурса"
  - input-field-s: "Ссылка"
  - button-sec-s: "Добавить ссылку"

#### Секция "Модификации"
- **Заголовок:** "Модификации"
- **counter:** "1 день" (deadline modification)
- **counter:** "3 дня" (deadline modification)

#### CTA
- **button-prim-s:** "Создать доску", full width

---

## 6. ЭКРАН: desk-flow (Flow Board)

**ID:** `1:445`

### 6.1 Структура

```
┌──────────────────────────────┐
│  ← Название доски    ⋮      │ Header с кнопкой назад
├──────────────────────────────┤
│  Спринт 3                    │
│  Auth & MCP                  │
│  19–25 мая                   │
│  6/14 дней                   │ sprint-compressed-info
├──────────────────────────────┤
│  ┌─ desk-signals ──────────┐ │
│  │ 1  Люди  @kitamoru 7/6  │ │
│  │ 3  Процессы  Ревью 2... │ │
│  │ 2  Эскалации            │ │
│  └─────────────────────────┘ │
├──────────────────────────────┤
│  ┌─ statuses ──────────────┐ │
│  │ 7  В работе             │ │
│  │ 1  Эскалации            │ │
│  │ 12 Готово               │ │
│  └─────────────────────────┘ │
├──────────────────────────────┤
│  [task-card]                  │
│  [task-card]                  │
│  [task-card]                  │ backlog / sprint tasks
├──────────────────────────────┤
│        buttom-menu            │
└──────────────────────────────┘
```

### 6.2 Элементы

**sprint-compressed-info:**
- "Спринт 3" — Inter Display Medium 14px/18px, `#FAFAFA`
- "Auth & MCP" — Inter Display Medium 12px/14px, `#8B8B8B`
- "19–25 мая" — Inter Regular 12px/16px, `#8B8B8B`
- "6/14 дней" — Inter Semi Bold 14px/18px, `#0FEE9E` (progress)

**desk-signals (3 колонки):**
- Люди: count (large), `@kitamoru 7/6`
- Процессы: count, "Ревью 2, Блокеры 13"
- Эскалации: count

**statuses (3 колонки):**
- "7 В работе"
- "1 Эскалации"
- "12 Готово"

---

## 7. ЭКРАН: desk / [desk_UUID] / edit (Настройки доски)

**ID:** `1:836`

### 7.1 Структура

```
┌──────────────────────────────┐
│  ← Настройки         ⋮      │
├──────────────────────────────┤
│  ── Основное ──────────────  │
│  Название доски              │
│  @desk                       │
│                              │
│  ── Коворкинг ─────────────  │
│  0 коллег                    │
│  [Добавить коллегу]          │
│                              │
│  ── Контекст доски ────────  │
│  Краткое описание            │ text-area-m
│                              │
│  ── Дополнительные материалы  │
│  [toggle] Документы          │
│  [toggle] Внешние ссылки     │
│                              │
│  [Удалить доску]             │ button-sec-s (red/destructive)
├──────────────────────────────┤
│        buttom-menu            │
└──────────────────────────────┘
```

---

## 8. ГРАДИЕНТЫ И ЭФФЕКТЫ

### 8.1 Градиенты
В макете используются следующие градиенты:

| Элемент | Тип | Цвета | Угол |
|---------|-----|-------|------|
| ref-bg-shape-outer (декор) | Linear | `#0A0A0A` → `#101010` | 180° |
| Акцентные элементы | Linear | `#0FEE9E` → `#0DCC88` | 180° |

### 8.2 Тени / Effects

| Элемент | Тип | Параметры |
|---------|-----|-----------|
| Карточки (task-card) | Drop shadow | 0px 4px 12px rgba(0,0,0,0.3) |
| bottom-sheet | Drop shadow | 0px -4px 12px rgba(0,0,0,0.4) |
| Кнопки primary | Drop shadow | 0px 2px 8px rgba(15,238,158,0.2) |

---

## 9. ИКОНКИ

Иконки в макете используются следующих типов:
- **Leading icons** — слева в инпутах/кнопках (16×16px или 20×20px)
- **Trailing icons** — справа в инпутах/кнопках (16×16px или 20×20px)
- **Menu icons** — в bottom-menu (24×24px)
- **Signal icons** — в desk-signals (16×16px)

Все иконки — stroke style, 1.5px или 2px stroke, цвет `#8B8B8B` (default) или `#FAFAFA` (active).

---

## 10. СОСТОЯНИЯ КОМПОНЕНТОВ

| Компонент | Состояния | Визуал |
|-----------|-----------|--------|
| button-prim-m | default / hover / pressed | default: accent; hover: lighter; pressed: darker |
| button-sec-s | default / hover / pressed | default: transparent border; hover: border brighter |
| input-field-m/s | default / focus / error | default: border rgba(255,255,255,0.2); focus: border accent; error: border red |
| toggle | on / off | on: bg accent; off: bg #161616 |
| task-card | default / pressed | default: bg #161616; pressed: bg #1A1A1A |

---

## 11. АНИМАЦИИ (из макета)

| Элемент | Анимация |
|---------|----------|
| bottom-sheet | Slide up, 300ms ease-out |
| toggle | Background color transition, 200ms |
| Кнопки | Scale 0.97 on press, 100ms |
| Переходы между экранами | Slide right, 350ms ease-in-out |

---

## 12. СПИСОК ВСЕХ КОМПОНЕНТОВ (100 шт.)

### Component Sets (30)
- `menu / tasks` — меню задач
- `menu / button-main` — главная кнопка меню
- `input-field-m` — инпут средний
- `cognitive-weight-indicator` — индикатор CW
- и другие...

### Key Components (14)
1. `buttom-menu` — нижнее меню
2. `button-prim-m` — primary кнопка (medium)
3. `button-prim-s` — primary кнопка (small)
4. `button-sec-s` — secondary кнопка (small)
5. `task-card` — карточка задачи
6. `task-CW-indicator` — индикатор когнитивного веса
7. `input-field-m` — поле ввода (medium)
8. `input-field-s` — поле ввода (small)
9. `text-area-m` — текстовая область (medium)
10. `toggle` — переключатель
11. `badge` — бейдж
12. `section-button-sec` — кнопка секции
13. `section-button-group` — группа кнопок секции
14. `cognitive-weight-container` — контейнер CW

---

## 13. ПРИМЕЧАНИЯ ДЛЯ АГЕНТА

1. **Все размеры в px.** Использовать `rem` конвертацию: 16px = 1rem
2. **Тёмная тема — единственная.** Нет светлой темы
3. **Шрифты:** Inter (основной), Inter Display (для заголовков)
4. **Сетка:** 4px base unit (все отступы кратны 4)
5. **Auto Layout** принципы: Flexbox (column/row), gap, padding
6. **Иконки** не экспортированы — нужны SVG из Figma или заменить на lucide-react
7. **Градиенты** только декоративные (ref-bg-shape-outer) — можно заменить на solid `#101010`
8. **Тени** — использовать Tailwind shadow классы
9. **Анимации** — использовать CSS transitions / framer-motion
10. **iOS Header** — можно скрыть в webapp (Telegram WebApp сам управляет status bar)
