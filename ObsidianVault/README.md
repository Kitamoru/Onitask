# ObsidianVault — AI Context Storage

Этот vault используется для хранения контекста проектов при работе с AI-агентом (Cline).

## Проекты

- [[onitask/Project Overview|OniTask]] — Next.js 16 + React 19 task management app

## Как использовать

AI-агент (Cline) имеет доступ к этому vault через MCP filesystem сервер.
Перед началом работы над задачей агент читает нужные заметки, чтобы не тратить токены на повторное изучение кодовой базы.

## Структура заметок проекта

```
onitask/
├── Project Overview.md    # Стек, структура, запуск
├── Architecture & Decisions.md  # Архитектура, решения, backlog
├── Context Log.md         # Лог изменений по сессиям
└── Components.md          # Реестр компонентов
```
