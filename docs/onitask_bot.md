# onitask · Telegram Bot — Функциональный контракт

**Версия:** 0.6.0
**Дата:** июнь 2026
**Статус:** Pre-Spec — готов к реализации

> **Схема БД** (`workspace_telegram_chats`) — см. [Master Spec](onitask_Architecture_Master_.md), раздел 6.9.
> Расширение CHECK `agent_events.tool` (добавлен `'bot_command'`) — [Master Spec 6.1](onitask_Architecture_Master_.md#61-изменения-существующих-таблиц).
> **Security**: `mcp_api_keys`, `data_sharing_level` — [Master Spec §6.4](onitask_Architecture_Master_.md#64-настройки-воркспейса). Подробнее — [onitask_security_.md](onitask_security_.md).

---

## 1. Концепция

Telegram Bot — второй системный клиент onitask наряду с TWA. Решает одну ключевую проблему: **задача родилась в чате и умерла**.

Команда обсуждает задачи в Telegram-группе, но создавать их нужно в другом месте. Переключение контекста убивает дисциплину. Bot ликвидирует этот разрыв: задача создаётся прямо там, где появилась — в чате, без переключений.

**Архитектурный принцип:** Bot использует те же backend-эндпоинты, что и TWA, через service token. Все действия логируются в `agent_events` (`tool = 'bot_command'`). Realtime-уведомления в чаты идут через Supabase Realtime + Bot API.

---

## 2. Команды бота

| Команда | Описание | Где работает | Связь с архитектурой |
|---|---|---|---|
| `/task` | Создать задачу текстом или голосом | Личные + групповые | F-04 Instant Parse |
| `/task ALPHA-123` | Показать карточку задачи по номеру | Личные + групповые | `find_task_by_full_id` RPC |
| `@onitask [текст]` | Создать задачу инлайн-вызовом | Групповые чаты | F-04 Instant Parse |
| `@onitask ALPHA-123` | Показать карточку задачи инлайн | Групповые чаты | `find_task_by_full_id` RPC |
| `/resolve ALPHA-123` | Снять флаг эскалации с задачи | Личные + групповые | `tasks.needs_human = false` |
| `/inbox` | Показать Inbox workspace | Личные + групповые | Stream: `is_inbox = true` |
| `/flow` | Краткий статус Flow Board + кнопка «Открыть» | Личные + групповые | Flow Metrics + deep link |
| `/summary` | AI Flow Summary: что стоит, кому помочь | Групповые чаты | F-03 Cold Path |
| `/standup` | Утренний дайджест команды (ручной вызов) | Личные + групповые | stuck_tasks + overloaded_workers + task_column_history |
| `/who` | Когнитивная нагрузка участников команды | Групповые чаты | F-01 Cognitive Budget |
| `/load` | Алиас `/who` — та же когнитивная нагрузка | Групповые чаты | F-01 Cognitive Budget |
| `/stuck` | Задачи с флагом `is_blocked` | Личные + групповые | `tasks.is_blocked` filter |
| `/review` | Задачи в колонке review для `reviewer_id = me` | Личные | `column = 'review'` |
| `/help` | Список доступных команд | Везде | — |

⚠️ **Голосовой ввод:** бот НЕ реагирует на голосовые автоматически. Пользователь должен явно вызвать `@onitask` или переслать голосовое с упоминанием `@onitask`. Авто-прослушивание запрещено (Telegram ToS + privacy).

---

## 3. Определение workspace

При команде из группового чата бот определяет целевой workspace (приоритет сверху вниз):

| Приоритет | Сценарий | Синтаксис | Поведение бота |
|---|---|---|---|
| 1 | Пользователь состоит ровно в одном workspace | (любая команда) | Используется автоматически, без вопросов |
| 2 | Чат жёстко привязан к workspace | `/task исправить баг` | Задача → в привязанный workspace |
| 3 | Явное указание через @ | `/task @alpha исправить баг` | Задача → в workspace «alpha» |
| 4 | В голосовом: «в доску альфа, задача: ...» | (голосовое) | NLP-парсер извлекает `target_workspace` из транскрипта |
| 5 | Нет явного указания, 2+ workspace — **last-used** | (любая команда) | Workspace где пользователь создавал задачи последним. Подпись к подтверждению: «создано в @alpha» |
| 6 | Нет данных (первая команда, 2+ workspace) | (любая команда) | Inline-кнопки выбора доступных workspace |

**Определение last-used workspace (приоритет 5):**

```sql
SELECT t.workspace_id
FROM tasks t
JOIN workers w ON w.id = t.assigned_to AND w.source_id = $telegram_user_id
ORDER BY t.created_at DESC
LIMIT 1;
```

Если запрос возвращает результат — используется без вопросов. Пользователь видит
footnote в подтверждении: «создано в @alpha · [не та доска?]». Клик на «не та доска?» →
бот предлагает список доступных workspace inline-кнопками.

> **Принцип:** бот никогда не угадывает молча. Либо есть однозначное правило (приоритеты 1–5),
> либо явный выбор (приоритет 6). Footnote — компромисс между скоростью и прозрачностью.

### Синтаксис в голосовом сообщении

NLP-парсер (F-04 Instant Parse, Groq llama-3.3-70b-versatile) извлекает `target_workspace` по паттернам:

```
"в доску альфа, задача: исправить баг"    → target_workspace: "alpha"
"добавь в @alpha: проверить деплой"        → target_workspace: "alpha"
"задача для команды разработки: ..."       → fuzzy match по display_name workspace
```

Если `target_workspace` не найден и чат не привязан — бот отвечает inline-кнопками выбора доступных workspace.

---

## 4. Freemium boundary

Все функции бота требуют платного плана. На Free-тарифе бот отвечает:

> «Создание задач через бот доступно с плана Solo (290₽/мес). Перейти: [ссылка на TWA настройки]»

| Функция | Free | Solo 290₽ | AI Dev / Team |
|---|---|---|---|
| `/task`, `@onitask` (текст) | ✗ | ✓ | ✓ |
| `/task` + голосовой ввод (Whisper) | ✗ | ✓ | ✓ |
| `/task ALPHA-123`, `@onitask ALPHA-123` | ✗ | ✓ | ✓ |
| `/resolve ALPHA-123` | ✗ | ✓ | ✓ |
| `/inbox`, `/flow` (просмотр) | ✗ | ✓ | ✓ |
| `/standup` (ручной вызов) | ✗ | ✓ | ✓ |
| `/summary` (AI Flow Summary) | ✗ | ✗ | ✓ |
| `/who`, `/load` (Cognitive Budget) | ✗ | ✗ | ✓ |
| Авто-standup по расписанию | ✗ | ✗ | ✓ |
| Уведомления о перемещениях задач | ✗ | ✓ тихий режим | ✓ алерты |

---

## 5. Ключевые сценарии

### 5.1 Голосовая задача в групповом чате

Самый ценный сценарий — именно здесь живёт основная боль.

1. Пользователь пересылает голосовое боту или пишет `@onitask` + прикладывает аудио
2. **Фаза 1 — немедленная реакция (P0-01):** бот делает два действия синхронно до начала обработки:
   - `sendChatAction('typing')` — Telegram показывает «печатает...»
   - `sendMessage` с placeholder «⏳ Обрабатываю голосовое...» — сохраняем `placeholder_message_id`
3. `POST /api/ai/transcribe` → Groq Whisper → транскрипт
4. F-04 Parse: Groq llama-3.3-70b-versatile → `rewritten_title`, `rewritten_description`, `clarity_score`, `complexity`, assignee, deadline, target_workspace. Промпт получает `workspace_context` и список участников workspace
5. Детерминированный Gatekeeper определяет `enrichment_strategy` (skip / light / standard)
6. **Защита от дублей (P0-01):** перед INSERT проверяем существование задачи с тем же `message_id`:
   ```sql
   SELECT id FROM tasks
   WHERE metadata->>'message_id' = $message_id
     AND metadata->>'source' = 'telegram_bot'
   LIMIT 1;
   ```
   Если запись найдена — пропускаем создание, редактируем placeholder на «уже зафиксировано».
7. Задача создаётся: `column = 'backlog'`, `is_inbox = true`, `description = rewritten_description`, `metadata.source = 'telegram_bot'`, `metadata.message_id = message.message_id`
8. Если `assignee` распознан — `assigned_to` заполнен, задача остаётся в Inbox
9. **Фаза 2 — финальный ответ:** `editMessageText(placeholder_message_id, result_text)` — placeholder заменяется результатом. Пользователь видит одно сообщение, не два.

Ответ (Фаза 2) зависит от `clarity_score`:

```
// clarity_score >= low_clarity_tag_threshold (default 0.55):
✅ Задача создана: «Исправить валидацию формы регистрации»
[Открыть в TWA]

// clarity_score < low_clarity_tag_threshold (P1-03):
📥 Зафиксировал: «Разобраться с проблемой» (ALPHA-48)
Задача неточная — уточни прямо в приложении.
[✏️ Уточнить ALPHA-48 →]        ← InlineKeyboard: deep link в TWA на задачу
```

> **Поведение `editMessageText` при сбое:** если редактирование упало (Telegram outage,
> сообщение удалено), бот отправляет новое сообщение с результатом. Пользователь может
> увидеть два сообщения в edge case — это допустимо. Дублирование задачи исключено
> через проверку `message_id` в шаге 6.

При `clarity_score < low_clarity_tag_threshold` задача получает тег `low-clarity` и всегда `is_inbox = true`.
Порог `low_clarity_tag_threshold` настраивается через `workspace_settings.f04_config` (default 0.55).

### 5.2 Текстовая задача инлайн

```
@onitask @alpha сделать интеграцию с платежкой для Ивана до пятницы
```

F-04 парсит → title, assignee (Иван), deadline, target_workspace (alpha).
Создаётся задача → подтверждение в чат + deep link в TWA.

### 5.3 Быстрый статус команды (/flow)

Менеджер пишет `/flow` в группе. Бот собирает Flow Metrics из БД (без LLM — Instant tier).

Карточка ответа:
```
📊 Flow Board · @alpha
В работе: 4 задачи (WIP limit: 6)
На проверке: 2 задачи
Заблокировано: 1 задача
⚠ Иван перегружен (3/3 когн. бюджет)
[Открыть Flow Board]
```

### 5.4 AI Flow Summary (/summary)

`/summary` вызывает F-03 Cold Path (NeuralDeep Hub · GPT-OSS-120B, Supabase Edge Function).
Результат — текстовая карточка с аномалиями и рекомендацией «кому помочь».
Доступно только на AI Dev / AI Team плане.

### 5.5 Авто-уведомления (Phase 1.1)

- При перемещении задачи `Inbox → Focus` бот пишет в привязанный чат
- При обнаружении bottleneck / overload — 1 алерт не чаще 1 раза в 2 часа
- Уведомления настраиваются через `workspace_telegram_chats.notification_settings`
- По умолчанию: тихий режим (`on_inbox_move: false`, `on_overload: false`)

### 5.6 Daily Standup (авто-дайджест)

Каждое утро в `standup_config.time_utc` бот пишет в привязанный чат:

```
📋 Стендап · пятница 30 мая

✅ Вчера двигалось:
· «Настроить CI» → На проверке (Vadim)
· «Исправить auth middleware» → Готово (Cursor)
· «Написать тесты» → В работе (Ivan)

⏳ Зависло (>72ч без движения):
· «Рефакторинг БД» — 4 дня в В работе (Anton)

⚠️ Перегружены:
· Vadim — когнитивный бюджет 3/3

📥 В inbox без подтверждения (>24ч):
· «Разобраться с проблемой» — создана 26ч назад (low-clarity) [уточнить →]
· «Что-то по авторизации» — создана 18ч назад [открыть →]

[Открыть Flow Board]
```

Правила форматирования:
- Если нет зависших задач и перегруженных — блоки ⏳ и ⚠️ не отображаются
- Если вчера ничего не двигалось — блок ✅ заменяется на «Вчера активности не было»
- Максимум 5 задач в блоке ✅ — остальные схлопываются: «...ещё 3 задачи»
- Блок 📥 отображается только при наличии `is_inbox=true AND created_at < NOW() - INTERVAL '24 hours'`. Максимум 3 задачи; каждая — с inline deep link `[уточнить →]` или `[открыть →]` в TWA на конкретную задачу. Задачи без тега `low-clarity` показывают `[открыть →]`, с тегом — `[уточнить →]`
- **Output sanitization (v0.5.0):** все `task.title` и `worker.display_name` перед вставкой
  в шаблон дайджеста экранируются через `escapeHtml()`. Предотвращает интерпретацию
  HTML-символов (`<`, `>`, `&`) в названиях задач как Telegram-разметки.

```typescript
// lib/bot.ts — применять ко всем полям перед вставкой в Telegram-сообщение
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Пример применения в standup-шаблоне:
// `· «${escapeHtml(task.title)}» → ${escapeHtml(column)} (${escapeHtml(assignee.display_name)})`
```

Источники данных: `task_column_history` (последние 24ч), вьюхи `stuck_tasks` и `overloaded_workers`. Без LLM — чистый SQL.

Настраивается через `workspace_settings.standup_config`. Только Admin/Owner.
Ручной вызов: `/standup` — тот же дайджест по требованию (Solo план+).

### 5.7 Вызов задачи по номеру

**Команда:**
```
/task ALPHA-45
```

Бот находит задачу через `find_task_by_full_id('ALPHA-45')` → показывает карточку + deep link:

```
📋 ALPHA-45 · «Настроить CI для frontend»
📍 В работе · @alpha
👤 Vadim · 🔴 Высокий приоритет
📅 До 2 июня
[Открыть в TWA]
```

**Инлайн в чате:**
```
@onitask ALPHA-45
```
Та же карточка, инлайн-ответ в чат.

**Инлайн-действие (Phase 2):**
```
@onitask ALPHA-45 done
```
Переместить задачу в done (требует прав Member+). Подтверждение: «✅ ALPHA-45 перемещена в Готово».

**Обработка ошибок:**
- Задача не найдена → «Задача ALPHA-45 не найдена. Проверь префикс доски — он указан в настройках workspace.»
- Нет доступа → «У тебя нет доступа к этой доске.»

---

### 5.8 Разрешение эскалации через бот (P1-09, P1-12)

Оператор получает Telegram-уведомление об эскалации с deep link и может разрешить её
не открывая TWA вручную.

**Формат уведомления об эскалации** (`alert_type='escalation'`):

```
🆘 ALPHA-45 · «Реализовать переключение темы»
Причина: Conflicting requirements
Агент: Cursor · 14:03

Suggested action: «Клиент хочет и dark mode и light mode — нужно уточнение»

[Открыть задачу →]        ← deep link: TWA /workspace/alpha?task=ALPHA-45&focus=escalation
[/resolve ALPHA-45]       ← текстовая подсказка для быстрого resolve
```

**Команда `/resolve ALPHA-45`:**

```
Оператор: /resolve ALPHA-45

Бот: ✅ Эскалация ALPHA-45 снята.
     Агент Cursor возобновит работу в течение минуты.
     [Открыть задачу →]
```

Обработка:
1. `find_task_by_full_id('ALPHA-45')` → проверка прав оператора (Member+ в workspace)
2. `UPDATE tasks SET needs_human = false` + `SET LOCAL app.skip_alert_triggers = 'true'`
   (триггер `trg_resolution_notify` запустить должны МЫ явно — пишем в очередь вручную,
   чтобы текст уведомления был корректным, а не из триггера)
3. `enrichment_queue INSERT { type: 'bot_notify', alert_type: 'escalation_resolved', ... }`
4. Ответ оператору: подтверждение + deep link

**Обработка ошибок `/resolve`:**
- Задача не найдена → «Задача ALPHA-45 не найдена»
- `needs_human = false` уже → «Задача ALPHA-45 уже разблокирована»
- Нет прав → «Только участники workspace могут снимать эскалации»

> **Маршрут:** `POST /api/bot/task/:fullId/resolve` — см. §6.1

---

### 5.9 Онбординг нового пользователя через инвайт (P1-19)

Полный флоу для пользователя, который впервые взаимодействует с ботом через invite-ссылку.
`/start` отдельно не нужен — invite-ссылка сама инициирует сессию.

**Флоу:**

```
Шаг 1: Пользователь кликает t.me/onitask_bot?start=ws_INVITE_CODE
        → Telegram автоматически открывает бот и отправляет /start ws_INVITE_CODE

Шаг 2: Бот получает update { text: '/start ws_INVITE_CODE' }
        → Проверяет invite_code в invite_links:
          - Не найден → «Ссылка недействительна. Попроси новую у администратора доски.»
          - Истёк / лимит → «Ссылка истекла. Попроси новую у @admin_name.»

Шаг 3: invite_code валидный →
        - Ищем workers WHERE source_id = telegram_user_id (уже в workspace?)
        - Нет записи → создаём worker + member role
        - Бот отвечает:

        👋 Добро пожаловать в @alpha!
        Ты добавлен как участник.

        Что можно делать прямо сейчас:
        · /task — добавить задачу голосом или текстом
        · /flow — посмотреть текущий статус доски
        · /standup — дайджест команды

        [Открыть Flow Board →]     ← deep link в TWA

Шаг 4: Пользователь кликает [Открыть Flow Board →]
        → TWA открывается с workspace уже авторизованным (initData + Supabase Auth)
        → Видит пустой или заполненный канбан
```

**Edge cases:**
- Пользователь уже состоит в workspace → «Ты уже в @alpha. [Открыть →]»
- Пользователь в другом workspace → добавляется как member во второй, оба остаются активными
- TWA не открывается (старая версия Telegram) → в сообщении бота вместо кнопки — прямая ссылка `https://t.me/onitask_bot/app`

---

## 6. Техническая интеграция

### 6.1 Новый слой `/api/bot/*`

Bot использует существующие эндпоинты через service token с ролью `bot`. Новые маршруты:

```
POST /api/bot/webhook          — входящие update от Telegram
POST /api/bot/task             — создание задачи из бота (адаптер над F-04)
GET  /api/bot/flow/:workspaceId — сбор Flow Metrics для /flow
GET  /api/bot/standup/:workspaceId — сбор данных для /standup (ручной вызов)
GET  /api/bot/task/:fullId     — резолюция ALPHA-123 → карточка задачи
POST /api/bot/task/:fullId/resolve — снять needs_human, уведомить агента (§5.8)
POST /api/bot/notify           — низкоуровневая отправка (sanitize + Bot API).
                                  Внутренний хелпер: вызывается Edge Function
                                  bot-notify (§6.5), не для внешних агентов
```

### 6.2 Адаптация F-04 (Instant Parse)

Bot-path использует единый `POST /api/ai/parse-task` с `source = 'telegram_bot'`. Поведение отличается от TWA:
- Correction Sheet **не показывается** (Telegram не поддерживает интерактивные формы в момент создания)
- `workspace_context` и список участников workspace передаются в промпт (аналогично TWA-path)
- `description = rewritten_description` если непустой, иначе `raw_input`
- Если `clarity_score < f04_config.low_clarity_tag_threshold` (default 0.55) — добавляется тег `low-clarity`, ответ бота меняется, добавляется InlineKeyboard `[✏️ Уточнить ALPHA-N →]`
- `enrichment_strategy` определяется детерминированным Gatekeeper (skip / light / standard)

**Двухфазный ответ (P0-01):**

```typescript
// Webhook handler — голосовое или /task
async function handleVoiceTask(msg: TelegramMessage) {
  // Фаза 1: немедленная реакция
  await bot.sendChatAction(msg.chat.id, 'typing');
  const { message_id: placeholderId } = await bot.sendMessage(
    msg.chat.id,
    '⏳ Обрабатываю...'
  );

  try {
    const task = await createTaskFromVoice(msg);
    // Фаза 2: заменяем placeholder результатом
    // buildConfirmation применяет escapeHtml() к task.title перед вставкой в HTML-шаблон
    // (v0.5.0, LLM-5 — предотвращает HTML-инъекцию через названия задач)
    await bot.editMessageText(buildConfirmation(task), {
      chat_id:    msg.chat.id,
      message_id: placeholderId,
      reply_markup: buildReplyMarkup(task)  // InlineKeyboard
    });
  } catch (err) {
    // editMessageText упал (Telegram outage, сообщение удалено)
    // Fallback: новое сообщение вместо редактирования
    await bot.sendMessage(msg.chat.id, buildConfirmation(task));
  }
}
```

**Защита от дублей (P0-01):**

```typescript
// Перед INSERT в tasks — проверяем message_id
async function isDuplicate(messageId: number): Promise<boolean> {
  const { data } = await supabase
    .from('tasks')
    .select('id')
    .eq('metadata->>message_id', String(messageId))
    .eq('metadata->>source', 'telegram_bot')
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// Если дубль — редактируем placeholder на нейтральное
if (await isDuplicate(msg.message_id)) {
  await bot.editMessageText('✅ Задача уже зафиксирована', {
    chat_id: msg.chat.id, message_id: placeholderId
  });
  return;
}
```

**STT Error Matrix (P1-02):**

| Тип ошибки | Условие | Действие | Сообщение пользователю |
|---|---|---|---|
| Сетевая ошибка | `fetch` бросил `NetworkError` или ECONNRESET | 1 тихий retry через 2с | При повторной ошибке: «Не удалось распознать — попробуй ещё раз.» Задача **не создаётся** |
| Groq timeout | Ответ > 8с | Fallback: `raw_input` как title | «⚠️ Распознавание не успело — задача создана с твоим текстом» |
| Groq offline (5xx) | HTTP 500–503 от Groq | Немедленный fallback на `raw_input` | «⚠️ AI временно недоступен — задача создана как есть. Уточни в TWA.» + `[Открыть →]` |
| Пустой транскрипт | `text === ''` | Не создавать задачу | «Не удалось разобрать аудио — попробуй ещё раз или напиши текстом.» |

> Fallback на `raw_input` означает: `tasks.title = raw_input.slice(0, 100)`, `clarity_score = null`,
> `enrichment_strategy = 'light'`. Задача создаётся с `is_inbox = true` — пользователь
> увидит её в Inbox и сможет уточнить.

При создании из бота обязательно записывать в `tasks.metadata`:

```json
{
  "source": "telegram_bot",
  "chat_id": -1001234567890,
  "message_id": 42,
  "target_workspace": "alpha"
}
```

### 6.3 Расширение F-06 (MCP Agent Router)

Инструмент `send_message_to_chat` для уведомлений из агентских сценариев (зарегистрирован в `agent_events.tool` CHECK — см. [Master Spec 6.1](onitask_Architecture_Master_.md#61-изменения-существующих-таблиц)):

```typescript
{
  tool: 'send_message_to_chat',
  params: {
    chat_id:    bigint,
    text:       string,
    parse_mode: 'HTML'
  }
}
```

**Output sanitization (v0.5.0, LLM-5):** Route Handler `/api/mcp/send_message_to_chat`
применяет `sanitizeOutput(text, 'tg')` до передачи в Bot API.
Whitelist тегов: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`.
Тег `<a href>` и все атрибуты удаляются — предотвращает фишинговые ссылки от агентов.

```typescript
// lib/bot.ts
import sanitizeHtml from 'sanitize-html';

export function sanitizeOutput(text: string, target: 'tg'): string {
  return sanitizeHtml(text, {
    allowedTags:        ['b', 'i', 'u', 's', 'code', 'pre'],
    allowedAttributes:  {},               // запрет всех атрибутов включая href
    disallowedTagsMode: 'discard'         // удалять запрещённые теги, не падать
  });
}
```

Ссылка на полный контракт sanitization — [mcp_contract_.md §4 send_message_to_chat](onitask_mcp_contract_.md#send_message_to_chat).

### 6.4 Realtime-уведомления

Supabase Realtime-триггер → Edge Function → Bot API `sendMessage` в привязанные чаты.

- Событие: `tasks.column` меняется с `backlog+is_inbox=true` → `in_progress`
- Запись в `workspace_telegram_chats` определяет, в какие чаты отправлять
- Rate limit: 1 алерт на overload / 2 часа / workspace

### 6.5 Bot Notify Worker

Единая точка доставки всех системных Telegram-алертов из `enrichment_queue`
(`type='bot_notify'`, Master §6.5). Закрывает вопрос «кто вычитывает эти записи»
— ранее упоминался в `security_.md §4.1` как факт без контракта.

**Источники записей** (воркер их не различает, обрабатывает единообразно):
- `check-anomalies-daily` (sql_anomalies_.md §4) — 7 типов ежедневных алертов
- `trg_escalation_alert` / `trg_resolution_notify` (sql_anomalies_.md §5.2, §5.5)
- `trg_cascade_unblock` (Master §6.16)
- `trg_handoff_chain_alert` (sql_anomalies_.md §5.7)
- `enrichment-failure-alert` cron (Master §9)
- Ручной INSERT из `/api/bot/task/:fullId/resolve` (§5.8)
- `trg_schedule_calendar_reminder` (Master §6.19, onitask_calendar_.md §5) — напоминания календаря

**Архитектура доставки:**

```
INSERT enrichment_queue (type='bot_notify')
  │
  ├─ DB Webhook (on INSERT WHERE type='bot_notify') ──┐
  │                                                     │
  └─ pg_cron 'bot-notify-fallback' (hourly, Master §9) ┤ страховка при пропущенном webhook
                                                          ▼
                                     Edge Function bot-notify (Deno)
                                                          │
              SELECT * FROM enrichment_queue
              WHERE type='bot_notify' AND status='pending'
                AND scheduled_at <= NOW()
              ORDER BY
                CASE WHEN payload->>'alert_type' = 'calendar_reminder' THEN 1
                     ELSE 2 END,
                scheduled_at ASC
              FOR UPDATE SKIP LOCKED LIMIT 20
                                                          │
                                     для каждой записи:
                                     1. Резолвить workspace_id
                                        (task_id → tasks.workspace_id, либо
                                        payload->>'workspace_id', либо
                                        event_id → calendar_events.workspace_id)
                                     2. Проверить payload->>'target_worker_id':
                                        ┌─ ЕСЛИ есть → личная доставка (§6.5.1)
                                        └─ ЕСЛИ нет → broadcast (§6.5.2)
                                     3. UPDATE enrichment_queue
                                        SET status='done'|'failed', processed_at=NOW()
```

### 6.5.1 Личная доставка (target_worker_id present)

Если `payload->>'target_worker_id'` присутствует (например, `alert_type='calendar_reminder'`):

```
1. Резолвим worker → profile:
   SELECT p.telegram_id
   FROM workers w
   JOIN profiles p ON p.id = w.source_id::uuid
   WHERE w.id = UUID(payload->>'target_worker_id')
     AND w.is_active = true
   LIMIT 1;

2. Если telegram_id найден:
   POST /api/bot/notify { chat_id: telegram_id, text, alert_type }
   → Telegram шлёт sendMessage напрямую в личный чат (chat_id = telegram_id)

3. Edge case: пользователь никогда не писал боту (/start не было)
   → Telegram вернёт 403 (Bot has no access), DM невозможен.
   → Обрабатываем как failed, БЕЗ ретраев (это не временная ошибка).
   → На старте почти все воркеры проходят через /start при онбординге (§5.9),
     так что это редкий кейс, но должен быть задокументирован, а не выяснен в проде.
```

Формат сообщения для `calendar_reminder`:
```
📅 Напоминание: «${event.title}»
⏰ Начало: ${formatTime(event.start_at)}
📍 Длительность: ${duration(event.start_at, event.end_at)}

[Открыть в TWA →]
```

### 6.5.2 Broadcast (target_worker_id absent)

Если `payload->>'target_worker_id'` отсутствует — текущее поведение:

```
1. SELECT chat_id FROM workspace_telegram_chats
   WHERE workspace_id = $1 AND is_active = true
2. Фильтр по notification_settings
   (on_inbox_move/on_overload/quiet_hours, §5.5) —
   не проходит фильтр → status='done' без отправки
3. POST /api/bot/notify { chat_id, text, alert_type, workspace_id }
   — на каждый привязанный чат
```

**Route Handler `POST /api/bot/notify`** (Vercel, внутренний — не для внешних агентов):

```typescript
// app/api/bot/notify/route.ts
export async function POST(req: Request) {
  const { chat_id, text, alert_type, workspace_id } = await req.json();

  // Единая точка sanitizeOutput() для bot_notify-пути (security_.md §4.1)
  const safeText = sanitizeOutput(text, 'tg');

  try {
    const res = await sendTelegramMessage(chat_id, safeText, { parse_mode: 'HTML' });
    return Response.json({ success: true, message_id: res.message_id });
  } catch (err) {
    if (err.telegram_code === 429) {
      return Response.json(
        { error: { code: 429, type: 'rate_limited', retry_after: err.retry_after } },
        { status: 429 }
      );
    }
    throw err;
  }
}
```

**Retry/backoff при 429** — закрывает риск §7 «Rate limits Bot API»:

```typescript
// Внутри Edge Function bot-notify
const RETRY_DELAYS = [2000, 10000, 30000]; // мс

for (const delay of RETRY_DELAYS) {
  const res = await callBotNotify(job);
  if (res.ok) break;
  if (res.status !== 429) { await markFailed(job); break; }
  await sleep(res.retry_after ? res.retry_after * 1000 : delay);
}
// После исчерпания retries — status='failed'. Не блокирует остальные job в батче.
```

**Дедупликация:** уже выполнена на уровне `send_alert_immediate` (sql_anomalies_.md §5.1,
2ч на `(alert_type, task_id)`) и `shouldSendAlert()` (sql_anomalies_.md §4) — воркер её
не повторяет, только доставляет.

**Множественные чаты:** алерт уходит во все активные чаты workspace (broadcast).
Привязка конкретного алерта к конкретному чату (например, `escalation_resolved` →
чат, откуда пришла эскалация) — Phase 1.1, не на MVP.

**Статусы:** переиспользуется существующий `enrichment_queue.status` (Master §6.5).
Отдельного поля не требуется.

> **Auth (открытая деталь реализации):** вызов Edge Function → `/api/bot/notify`
> требует service-to-service аутентификации по аналогии с MCP `timingSafeEqual` (A-2).
> Конкретный секрет — уточнить в dev_setup §5 при реализации, не блокирует спеку.

---

## 7. Риски и митигация

**Спам в чатах**
`notification_settings.on_inbox_move` и `on_overload` по умолчанию = false. Включает только Admin/Owner.

**Rate limits Bot API**
Очередь отправки через `enrichment_queue` (`type = 'bot_notify'`). Экспоненциальный backoff при 429.

**Privacy в групповых чатах**
Бот читает только явные вызовы (`@onitask`, `/команды`, пересланные сообщения). Авто-прослушивание отключено навсегда.

**Workspace collision**
Если workspace определить невозможно — бот всегда спрашивает, не угадывает (см. раздел 3).

---

## 8. Roadmap

| Фаза | Срок | Функции |
|---|---|---|
| MVP Bot | 2–3 нед. | `/task` (текст + голос) с двухфазным ответом + duplicate guard, `@onitask`, `/inbox`, `/flow`, подтверждение + deep link, workspace resolution (last-used), `/task ALPHA-123`, `/resolve ALPHA-123`, онбординг через invite (§5.9) |
| Phase 1.1 | +1–2 нед. | `/summary` (AI Flow Summary), авто-уведомления при Inbox→Focus, `/stuck`, `/review`, `/standup` с блоком 📥 inbox |
| Phase 2 | +2–3 нед. | `/who` + `/load` (Cognitive Budget), алерты при bottleneck/overload с deep link в TWA, rate limit 1 алерт / 2 часа, авто-standup по расписанию |
| Phase 3 | Post-MVP | `@onitask ALPHA-45 done` инлайн-действие; reply на сообщение → подзадача/комментарий; пересылка голосового с `@onitask` → задача из контекста |

⚠️ **Оценка MVP Bot:** 2–3 недели соло. Включает: Whisper transcription, F-04 адаптер, Bot webhook, workspace resolution, `/task` + `/inbox` + `/flow` + подтверждения + deep links, двухфазный ответ, duplicate guard, `/resolve`.

---

## Changelog

**v0.6.0 — июнь 2026**

*Bot Notify Worker — закрытие архитектурного пробела:*

- §6.1: уточнено назначение `POST /api/bot/notify` — внутренний хелпер (sanitize + Bot API),
  вызывается Edge Function `bot-notify` (§6.5), не предназначен для внешних агентов
- §6.5 (новый): контракт Bot Notify Worker — единая точка доставки всех алертов из
  `enrichment_queue` (`type='bot_notify'`). Архитектура: DB Webhook (мгновенная доставка) +
  hourly pg_cron fallback (Master §9, страховка при пропущенных событиях) — паттерн,
  консистентный с `workspace_context_rebuild` (Master §6.16). Документированы: 6 источников
  записей, полный флоу воркера (резолюция workspace, фильтр по `notification_settings`,
  broadcast во все привязанные чаты), реализация `POST /api/bot/notify` с `sanitizeOutput()`,
  retry/backoff при `429` от Telegram (закрывает риск §7 «Rate limits Bot API»). Закрывает
  расхождение с `security_.md §4.1`, где ранее фигурировала неспецифицированная
  «Edge Function bot_notify воркер»

**v0.5.0 — июнь 2026**

*Security Layer (OWASP LLM Top 10 2025 — LLM-5 Improper Output Handling):*

- Header: обновлены ссылки в шапке — Master Spec и security doc (onitask_security_.md)
- §5.6: добавлена реализация `escapeHtml()` в правилах форматирования standup-дайджеста.
  Все `task.title` и `worker.display_name` экранируются перед вставкой в Telegram HTML-шаблон.
  Предотвращает интерпретацию `<`, `>`, `&` в названиях задач как разметки
- §6.2: добавлен комментарий о применении `escapeHtml()` внутри `buildConfirmation(task)` —
  явная документация контракта функции для разработчика
- §6.3: расширена секция F-06 MCP Router — добавлена документация `sanitizeOutput(text, 'tg')`
  с TypeScript-реализацией через `sanitize-html`; whitelist тегов `<b><i><u><s><code><pre>`;
  запрет `<a href>` и всех атрибутов; ссылка на mcp_contract_.md §4 как канонический контракт

**v0.4.0 — май 2026**
- §2: добавлена команда `/resolve ALPHA-123` — снять эскалацию прямо из Telegram
- §3: реструктурирована таблица workspace resolution (6 приоритетов вместо 5). Добавлен приоритет 5 — last-used workspace через SQL lookup. Закрывает P1-01
- §4: `/resolve ALPHA-123` добавлен в Freemium-таблицу (Solo+)
- §5.1: переписан флоу голосовой задачи — двухфазный ответ (`sendChatAction` + placeholder → `editMessageText`). Защита от дублей через `metadata.message_id`. InlineKeyboard `[✏️ Уточнить →]` для low-clarity задач. Закрывает P0-01, P1-03, P1-04
- §5.6: добавлен блок «📥 В inbox без подтверждения (>24ч)» в standup-дайджест. Макс. 3 задачи с deep link inline-кнопками. Закрывает P1-05
- §5.8 (новый): сценарий `/resolve ALPHA-123` — формат уведомления об эскалации с deep link `[Открыть задачу →]` и инструкцией `/resolve`. Закрывает P1-09, P1-12
- §5.9 (новый): полный флоу онбординга нового пользователя через invite-ссылку. `/start ws_CODE` без предварительного `/start`. Edge cases: уже в workspace, Telegram без mini apps. Закрывает P1-19
- §6.1: добавлен маршрут `POST /api/bot/task/:fullId/resolve`
- §6.2: расширен — двухфазный ответ (TypeScript), защита от дублей, STT Error Matrix (network / timeout / offline / пустой транскрипт). Закрывает P1-02
- §8 Roadmap: MVP-список обновлён

---

*onitask · Telegram Bot Functional Contract · v0.6.0 · июнь 2026*
