# OniTask — Project Overview

## Описание
**OniTask** — веб-приложение на базе Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4.

## Технологический стек
- **Framework**: Next.js 16.2.2 (App Router)
- **UI**: React 19.2.4
- **Стили**: Tailwind CSS v4 + PostCSS
- **Язык**: TypeScript 5
- **Линтер**: ESLint 9 + eslint-config-next

## Структура проекта
```
onitask/
├── src/app/          # App Router pages & layouts
├── public/           # Статические файлы
├── next.config.ts    # Конфиг Next.js
├── tsconfig.json     # TypeScript конфиг
├── eslint.config.mjs # ESLint конфиг
├── postcss.config.mjs
└── .prettierrc
```

## Запуск
```bash
npm run dev    # http://localhost:3000
npm run build
npm run start
npm run lint
```

## Важные замечания
- Используется **Next.js 16** — могут быть отличия от привычного Next.js 14/15
- Перед написанием кода читать `node_modules/next/dist/docs/` (см. AGENTS.md)
- App Router (не Pages Router)

## Ссылки
- Репозиторий: `c:\Users\md_li\Documents\onitask`
