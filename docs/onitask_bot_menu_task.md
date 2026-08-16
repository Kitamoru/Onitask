# /task через меню TWA

## Обзор

Два пути создания задачи через бота:

### 1. Через команду /task (pending mode)
```
Пользователь: /task
Бот: "Для создания задачи пришлите текст или голосовое сообщение."
Пользователь: "купить молока с хлебом"
Бот: [черновик сохранён] "Выберите доску:" [keyboard]
Пользователь: выбирает доску
Бот: "✅ Задача создана #ALPHA-123"
```

**Где используется:**
- Прямой чат с ботом
- Голосовые сообщения
- Черновик сохраняется в `bot_task_drafts` с `source='pending'`
- Pending marker удаляется при создании реального черновика

### 2. Через кнопку в TWA меню
```
Пользователь: нажимает "Создать задачу" в TWA
Телеграм: открывает input field с placeholder
Пользователь: вводит текст и отправляет
Бот: [создаёт задачу через F-04] "✅ Задача создана #ALPHA-123"
```

**Преимущества:**
- Нет необходимости в pending mode
- Меньше шагов (нет сохранения черновика)
- Лучше для мобильных пользователей

**Реализация:**
```typescript
// В TWA использовать Telegram.WebApp.openLink или 
// ReplyKeyboardMarkup с input_field_placeholder
const keyboard = {
  reply_markup: {
    force_reply: true,
    input_field_placeholder: 'Опишите задачу...'
  }
};
```

## Архитектура

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram Chat     │     │   TWA Web App    │     │  F-04 Pipeline  │
├─────────────────────┤     ├──────────────────┤     ├─────────────────┤
│ /command            │     │ "Создать задачу" │     │                 │
│   ↓                 │     │   ↓              │     │ Groq parse      │
│ setPendingTask()    │     │ openInputField() │     │   ↓              │
│   ↓                 │     │   ↓              │     │ enrichment      │
│ text message        │     │ text message     │     │   ↓              │
│   ↓                 │     │   ↓              │     │ create task     │
│ isPendingTaskMode() │     │ POST /api/tasks  │     │   ↓              │
│   ↓                 │     │                  │     │ confirmation    │
│ clearPendingTask()  │     │                  │     │                 │
│   ↓                 │     │                  │     │                 │
│ create_bot_task_    │     │                  │     │                 │
│ draft()             │     │                  │     │                 │
│   ↓                 │     │                  │     │                 │
│ show board keyboard │     │                  │     │                 │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
```

## Pending Mode Flow (текущая реализация)

1. `/task` без аргументов → `setPendingTask(chatId, profileId)`
2. Вставляет запись в `bot_task_drafts`:
   - `title = '__PENDING_TASK__'`
   - `source = 'pending'`
   - `expires_at = now() + 10min`
3. Бот ждёт следующее сообщение
4. При получении текста:
   - `isPendingTaskMode(chatId)` → проверяет наличие pending marker
   - `clearPendingTask(chatId)` → удаляет pending marker
   - `create_bot_task_draft()` → создаёт реальный черновик
   - Показывает клавиатуру досок

## Debug Logging

Для отладки добавлены console.log в webhook:
```
[Bot Webhook] Step 4: pendingActive= true chatId= 123 textLen= 25 hasVoice= false
[Bot Webhook] Step 4: profileId= abc-def-ghi
[Bot Webhook] Step 4: Creating draft, taskText= купить молока с хлебом source= nl
[Bot Webhook] Draft created successfully, draftId= 123
[Bot Webhook] Step 4: availableWorkspaces count= 2
```

## Связанные файлы

- `src/lib/bot/taskDraft.ts` — setPendingTask, clearPendingTask, isPendingTaskMode
- `src/app/api/bot/webhook/route.ts` — dispatchUpdate Step 4
- `src/lib/bot/commands.ts` — handleCommand /task case
- `supabase/migrations/030_bot_task_drafts.sql` — schema bot_task_drafts
- `supabase/migrations/031_bot_task_draft_consume_latest.sql` — consume RPC
- `supabase/migrations/032_bot_task_drafts_pending_source.sql` — pending source check