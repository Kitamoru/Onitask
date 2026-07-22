# Figma: Экран "desk / create" (Board Wizard)

## Node-IDs

| Что | Node ID | Описание |
|-----|---------|----------|
| **Компонент** | `1:913` | Сам компонент "desk / create" |
| **Экземпляр на канвасе** | `65:7715` | Полный экран с Screen, buttom-menu, Status bar |
| **Контент** | `65:7780` | Только содержимое (скроллящийся список) |

## Получение данных через Figma MCP

```bash
# Получить весь экран целиком
use_mcp_tool figma get_figma_data fileKey="EhjoAgxmDSPu7jsuUEXl46" nodeId="65:7715"

# Получить только контент (без header/footer)
use_mcp_tool figma get_figma_data fileKey="EhjoAgxmDSPu7jsuUEXl46" nodeId="65:7780"
```

## Структура секций

```
desk / create (65:7780)
├── main (Основное)
│   ├── heading: "Основное" (yellow line)
│   ├── input-field-m: "Название доски"
│   └── input-field-m: "@desk"
├── func (Функциональное)
│   ├── heading: "Функциональное"
│   ├── storypoints-toggle (SP toggle)
│   │   ├── toggle: "Стоимость сторипоинта"
│   │   └── 6x input-field-s: 1 SP, 1 час, 3 SP, 5 SP, 7 SP, 13 SP
│   ├── CW-toggle (CW toggle)
│   │   ├── toggle: "Когнитивный вес"
│   │   └── description text
│   └── ref-bg-shape-outer (декоративный фон)
├── mates (Коворкинг)
│   ├── heading: "Коворкинг"
│   ├── badge: "0 коллег"
│   └── button-sec-s: "Добавить коллегу"
├── context (Контекст доски)
│   ├── heading: "Контекст доски"
│   └── text-area-m: "Краткое описание"
├── extention (Дополнительные материалы)
│   ├── md-docs
│   │   ├── toggle: "Документы"
│   │   ├── input-field-s (file picker)
│   │   ├── hint: "до 10 документов, до 5мегабайт в сумме, формат .md"
│   │   └── button-sec-s: "Добавить .md файл"
│   └── external-links
│       ├── toggle: "Внешние ссылки"
│       ├── input-field-s: "Название ресурса"
│       ├── input-field-s: "Ссылка"
│       └── button-sec-s: "Добавить ссылку"
├── mod (Модификации)
│   ├── heading: "Модификации"
│   ├── counter: "1 день" (+/-)
│   └── counter: "3 дня" (+/-)
└── button-prim-s: "Создать доску"
```

## Используемые компоненты

| Компонент | ID | Свойства |
|-----------|-----|----------|
| `input-field-m` | `7:7734` | leading-icon, trailing-icon |
| `input-field-s` | `7:8086` | leading-icon, trailing-icon |
| `text-area-m` | `83:17453` | leading-icon, trailing-icon |
| `toggle` | `22:5993` | is-active |
| `badge` | `17:8819` | text |
| `button-sec-s` | `7:8172` | show leading-icon, show trailing-icon, label |
| `button-prim-s` | `7:7369` | show leading-icon, show trailing-icon, label |
| `counter` | `424:32469` | - |

## Design Tokens для экрана

### Layout
- Screen: 390×844px
- Padding: 16px
- Gap между секциями: 24px
- Border-radius: 4px (карточки NotchedPanel default), 8px (small containers notch), 16px (large containers notch default), 6px (инпуты), 999px (кнопки)

### NotchedPanel Radius & Notch Values
- Default `radius`: 4 px (changed from 16 in v0.13.3+)
- Default `notch`: 16 px (large container chamfer)
- Small containers: pass `notch={8}` for 8 px chamfer
- Large containers: use default `notch={16}` or omit prop

### Цвета
- Background: `#0A0A0A`
- Surface: `#101010`
- Surface card: `#161616`
- Text primary: `#8B8B8B`
- Text secondary: `#FAFAFA`
- Accent: `#0FEE9E`
- Yellow line: `#F59E0B`
- Border: `rgba(255, 255, 255, 0.2)`

### Typography
- Headings: Inter Display Medium 14px/18px
- Input labels: Inter Medium 16px/20px
- Button text: Inter Semi Bold 14px/18px
- Hint text: Inter Regular 12px/16px

## Связанные файлы

- `docs/design/figma-onitask-dev.json` — полные метаданные макета
- `docs/design/figma-components-detailed.json` — детальная структура компонентов
- `docs/design/figma-onitask-README.md` — общая документация
