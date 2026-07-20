# Figma Design Data - ONITASK

## Overview
This document provides access to the Figma design data for the ONITASK project.

**Figma File:** https://www.figma.com/design/EhjoAgxmDSPu7jsuUEXl46/-dev--ONITASK?node-id=0-1&p=f&t=IAG0OXhVgh0KrcvL-11

**File Key:** `EhjoAgxmDSPu7jsuUEXl46`

## Available JSON Files

### 1. `figma-onitask-dev.json`
Основные метаданные макета:
- Список экранов (screens)
- Компоненты с property definitions
- Глобальные переменные (цвета, layout)
- Ключевые компоненты для разработки

### 2. `figma-components-detailed.json`
Детальная информация о компонентах:
- Структура экранов с элементами
- Определения компонентов с вариантами
- Стили текста (шрифты, размеры, line-height)
- Цветовая палитра
- Layout параметры (390x844, border-radius 24px)

## Key Components

| Component | ID | Description | Properties |
|-----------|-----|-------------|------------|
| button-prim-m | 7:6302 | Primary button (medium) | show leading-icon, show trailing-icon, label |
| button-prim-s | 7:7369 | Primary button (small) | show leading-icon, show trailing-icon, label |
| button-sec-s | 7:8172 | Secondary button (small) | show leading-icon, show trailing-icon, label |
| input-field-m | 7:7734 | Input field (medium) | leading-icon, trailing-icon |
| text-area-m | 83:17453 | Text area (medium) | leading-icon, trailing-icon |
| toggle | 22:5993 | Toggle switch | is-active |
| badge | 17:8819 | Badge component | text |
| task-card | 10:10763 | Task card | has-svetofor, show-status |
| task-CW-indicator | 167:22591 | Cognitive weight indicator | weight variants (0-3) |
| bottom-sheet | 210:21251 | Bottom sheet modal | - |
| buttom-menu | 1:433 | Bottom menu | - |

## Screens

1. **start** - Стартовый экран с логотипом и кнопкой "Начать"
2. **desk / create** - Создание доски (Board Wizard)
3. **desk [empty]** - Пустая доска
4. **desk-flow** - Flow доска с задачами
5. **desks-stream** - Список досок
6. **desk / [desk_UUID] / edit** - Настройки доски
7. **desk / task / view** - Просмотр задачи
8. **desk / task / create** - Создание задачи

## Design Tokens

### Colors
```css
--color-background: #0A0A0A;
--color-surface: #101010;
--color-text-primary: #8B8B8B;
--color-text-secondary: #000000;
--color-accent: #0FEE9E;
--color-border: rgba(0, 0, 0, 0.05);
--color-divider: rgba(255, 255, 255, 0.2);
```

### Typography
```css
--font-family: 'Inter', 'Inter Display';
--text-body-16-20-sb: 16px / 20px Semi Bold;
--text-body-14-18-m: 14px / 18px Medium;
--text-body-12-14-m: 12px / 14px Medium;
```

### Layout
```css
--screen-width: 390px;
--screen-height: 844px;
--border-radius: 24px;
--padding: 16px;
```

## How to Get Full Data

Для получения полных данных используйте Figma API:

```bash
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/EhjoAgxmDSPu7jsuUEXl46?geometry=paths"
```

Или используйте MCP инструмент:
```
cU1-HU0mcp0get_figma_data fileKey="EhjoAgxmDSPu7jsuUEXl46" nodeId="0-1"
```

## Integration Notes

- Все компоненты следуют дизайн-системе с Inter/Drop font
- Акцентный цвет: #0FEE9E (электроголубой)
- Темная тема (background: #0A0A0A)
- Telegram WebApp адаптация (см. `telegram-webapp-refactor.md`)