# onitask · Telegram Bot — Функциональный контракт

**Версия:** 0.6.5
**Дата:** август 2026
**Статус:** Spec-ready — кнопка карточки задачи ведёт в Mini App через Direct Link (`startapp`), а не во внешний браузер; аутентификация запроса задачи через `initData`.

> **Схема БД** (`workspace_telegram_chats`) — см. [Master Spec](onitask_Architecture_Master_.md), раздел 6.9.
> Расширение CHECK `agent_events.tool` (добавлен `'bot_command'`) — [Master Spec 6.1](onitask_Architecture_Master_.md#61-изменения-существующих-таблиц).
> **Security**: `mcp_api_keys`, `data_sharing_level` — [Master Spec §6.4](onitask_Architecture_Master_.md#64-настройки-воркспейса). Подробнее — [onitask_security_.md](onitask_security_.md).

---

## 0. Что изменилось в этой ревизии

Полный список — в [Changelog v0.6.5](#v065--август-2026). Главное:

1. **Найден и исправлен баг кнопки карточки задачи** (обнаружен на ревью). `taskUrl()` собирал обычную HTTPS-ссылку на `TWA_URL` — тап открывал бы внешний браузер без `initData`, а не Mini App. `InlineKeyboardButton.web_app` не подходит — доступен только в приватных чатах с ботом, не в группах. Исправлено на Direct Link Mini App (`https://t.me/<bot>/<app>?startapp=task_{full_id}`) через новую `miniAppDeepLink()` — работает в любом чате, открывает именно Mini App.
2. **Frontend-код чтения `start_param`** сознательно на `window.Telegram.WebApp` (официальный, поддерживаемый Telegram API), а не на npm-обёртке `@telegram-apps/sdk` — у той было минимум одно ломающее изменение между мажорными версиями.
3. **Добавлена аутентификация запроса задачи через `initData`** — пример `fetch` без заголовка авторизации не проверял бы, кто спрашивает и есть ли доступ к доске; исправлено.

Изменения из предыдущих версий — см. [Changelog v0.6.4](#v064--август-2026) и далее.

---

## 1. Концепция

Telegram Bot — второй системный клиент onitask наряду с TWA. Решает одну ключевую проблему: **задача родилась в чате и умерла**.

Команда обсуждает задачи в Telegram-группе, но создавать их нужно в другом месте. Переключение контекста убивает дисциплину. Bot ликвидирует этот разрыв: задача создаётся прямо там, где появилась — в чате, без переключений.

**Архитектурный принцип:** Bot использует те же backend-эндпоинты, что и TWA, через service token. Все действия логируются в `agent_events` (`tool = 'bot_command'`). Уведомления о движении задач в чаты идут через очередь (`enrichment_queue`, тип `bot_notify`), которую наполняет Postgres-триггер и опустошает pg_cron-воркер, вызывающий Bot API с учётом rate limit'ов — см. §6.4. Клиентский Supabase Realtime здесь не участвует: это механизм для браузера/TWA, а не для server-to-server триггеров.

---

## 2. Команды бота

| Команда | Описание | Где работает | Связь с архитектурой |
|---|---|---|---|
| `/task` | Создать задачу текстом или голосом | Личные + групповые | F-04 Instant Parse, см. §5.1 |
| `/task ALPHA-123` | Показать карточку задачи по номеру | Личные + групповые | `find_task_by_full_id` RPC |
| `@onitask [текст]` | Создать задачу инлайн-вызовом (только текст, см. §5.1.3) | Групповые чаты | F-04 Instant Parse через `chosen_inline_result` |
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

⚠️ **Голосовой ввод:** бот НЕ реагирует на голосовые автоматически. Пользователь должен явно вызвать `/task` с прикреплённым голосовым, либо переслать/отправить голосовое с caption `@onitask_bot` (в группе — обязательно, см. §5.1). Авто-прослушивание запрещено (Telegram ToS + privacy).

---

## 3. Определение workspace

При команде из группового чата бот определяет целевой workspace (приоритет сверху вниз):

| Приоритет | Сценарий | Синтаксис | Поведение бота |
|---|---|---|---|
| 1 | Пользователь состоит ровно в одном workspace | (любая команда) | Используется автоматически, без вопросов |
| 2 | Чат жёстко привязан к workspace | `/task исправить баг` | Задача → в привязанный workspace |
| 3 | Явное указание через @ | `/task @alpha исправить баг` | Задача → в workspace «alpha» |
| 4 | В голосовом/тексте: «в доску альфа, задача: ...» | (голосовое или текст) | NLP-парсер извлекает `target_workspace` из транскрипта/текста |
| 5 | Нет явного указания, 2+ workspace — **last-used** | (любая команда) | Workspace где пользователь создавал задачи последним. Подпись к подтверждению: «создано в @alpha» |
| 6 | Нет данных (первая команда, 2+ workspace) | (любая команда) | **Асинхронная ветка** — inline-кнопки выбора, пауза до ответа пользователя. Полный механизм — §6.2b |

Приоритеты 1–5 резолвятся синхронно, без участия пользователя, в рамках одного вебхук-вызова. Приоритет 6 — единственный случай, требующий interaction, и именно он определяет архитектуру §6.2b (сохранение черновика + `callback_query`).

**Определение last-used workspace (приоритет 5):**

```sql
SELECT t.workspace_id
FROM tasks t
JOIN workers w ON w.id = t.assigned_to AND w.source_id = $telegram_user_id
ORDER BY t.created_at DESC
LIMIT 1;
```

### Синтаксис в голосовом/текстовом сообщении

NLP-парсер (F-04 Instant Parse, Groq llama-3.3-70b-versatile) извлекает `target_workspace` по паттернам:

```
"в доску альфа, задача: исправить баг"    → target_workspace: "alpha"
"добавь в @alpha: проверить деплой"        → target_workspace: "alpha"
"задача для команды разработки: ..."       → fuzzy match по display_name workspace
```

---

## 4. Freemium boundary

Все функции бота требуют платного плана. На Free-тарифе бот отвечает:

> «Создание задач через бот доступно с плана Solo (290₽/мес). Перейти: [ссылка на TWA настройки]»

Проверка выполняется одинаково для всех трёх точек входа §5.1 (команда, голос, инлайн) — до запуска F-04, сразу после определения `telegram_user_id`.

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

### 5.1 Постановка задачи: точки входа и общий пайплайн

Bot принимает новую задачу тремя способами. Это не три варианта одного и того же события — это три разных типа Telegram update с разной механикой ответа:

| Точка входа | Тип update | Несёт голос? | Механика ответа |
|---|---|---|---|
| `/task <текст>` в чате | `message` | нет | `sendMessage`/`editMessageText` по `chat_id` + `message_id` |
| Голосовое боту (в личке — просто отправить; в группе — с caption `@onitask_bot` или reply на бота) | `message` (поле `voice` заполнено) | да | Те же `chat_id`+`message_id`, плюс `setMessageReaction` |
| `@onitask <текст>` в поле ввода | `inline_query` → затем `chosen_inline_result` | нет, инлайн только текст | `answerInlineQuery` → позже `editMessageText` по `inline_message_id` |
| Reply `/task` на существующее сообщение (§5.1.4) | `message` (`reply_to_message` заполнено) | да, если реплай на голосовое | Те же `chat_id`+`message_id`, источник текста — `reply_to_message`, не `message.text` |

**Инлайн-режим технически не может нести голос.** `inline_query.query` — это строка, ничего больше; прикрепить файл к инлайн-запросу невозможно на уровне протокола. Поэтому формулировка «пишет `@onitask` и прикладывает аудио» из более ранних версий этого документа описывала несуществующий путь. Голосовая задача — это всегда обычное `message`-событие с непустым полем `voice`, независимо от того, где отправлено сообщение.

**Group Privacy Mode.** По умолчанию бот в группе получает не весь трафик, а только: команды (`/...`), reply на сообщения самого бота, и сообщения, где бот явно упомянут (`@onitask_bot` в тексте или в caption). Управляется в BotFather (`/setprivacy`). Для onitask это должно быть включено — бот не должен видеть весь чат, только явные обращения. Практическое следствие: caption `@onitask_bot` на голосовом сообщении в группе — не подсказка для пользователя, а единственный способ, которым это сообщение вообще дойдёт до вебхука, если это не прямой reply на бота.

**Forum topics.** Если в группе включены топики (Forum), у входящего `message` заполнено поле `message_thread_id`. Все ответы бота в этом чате (реакция не в счёт — она не создаёт сообщение) обязаны передавать тот же `message_thread_id` в `sendMessage`/`sendRichMessageDraft`/`editMessageText` — иначе прогресс-сообщение и финальная карточка уйдут в топик «Общий», а не туда, где пользователь фактически писал. Это тянется через весь пайплайн как одно поле в `MessageLocator` (§6.2) — не отдельная ветка логики.

**Freemium-проверка** (§4) выполняется первым шагом во всех четырёх пайплайнах ниже, сразу после определения `telegram_user_id` — до вызова F-04.

---

#### 5.1.1 Голосовая задача — полный пайплайн

1. **Приём.** `message.voice` присутствует. Freemium-проверка (Solo+, §4) — иначе upsell-ответ и выход.
2. **Webhook ACK.** `secret_token` проверен, `200` отдан немедленно; вся дальнейшая обработка — в фоне (`waitUntil`/`after()`), см. §6.1.
3. **Фаза 0 — реакция.** `setMessageReaction(chat_id, message_id, [{type:'emoji', emoji:'👀'}])`. Fire-and-forget: ошибка здесь не блокирует пайплайн.
4. **Фаза 1 — прогресс.** `sendProgress()` пробует `sendRichMessageDraft` (Bot API 10.1, за фича-флагом), при недоступности — обычный `sendMessage('⏳ Обрабатываю голосовое...')`. Возвращает `progress_message_id` — его отредактируют на шаге 10.
5. **Скачивание файла.** `getFile(voice.file_id)` → проверка `file_size ≤ 20 МБ` → скачивание по `api.telegram.org/file/bot<token>/<file_path>`. Превышение лимита — сразу к шагу 10 с `FILE_TOO_LARGE`, STT не вызывается, задача не создаётся.
6. **STT.** Файл → Groq Whisper, таймаут 8с. Ошибки — по STT Error Matrix, уровень 1 (§6.2, транскрипта ещё нет).
7. **F-04 parse.** Транскрипт → Groq llama-3.3-70b-versatile → `rewritten_title`, `rewritten_description`, `clarity_score`, `assignee`, `deadline`, `target_workspace`. Ошибки на этом шаге — STT Error Matrix, уровень 2 (транскрипт уже есть).
8. **Резолюция доски.** §3 + §6.2b. Либо продолжает синхронно (шаг 9), либо сохраняет `bot_pending_drafts` и завершает текущий вызов на клавиатуре выбора — тогда шаги 9–10 выполнятся в отдельном вызове, обрабатывающем `callback_query`.
9. **Dedup + insert.** `dedup_key = 'msg:' + chat_id + ':' + message_id`. Атомарная вставка с обработкой конфликта по `metadata->>'dedup_key'` (см. §6.2, было исправлено — раньше ключ строился только из `message_id`, без `chat_id`).
10. **Финализация.** `editMessageText` (или `sendRichMessage` за фича-флагом) заменяет прогресс-сообщение на карточку задачи. Реакция на исходном голосовом → ✅, либо снимается при ошибке.

Ответ на шаге 10 зависит от `clarity_score`:

```
// clarity_score >= low_clarity_tag_threshold (default 0.55):
✅ Задача создана: «Исправить валидацию формы регистрации»
[Открыть в приложении]

// clarity_score < low_clarity_tag_threshold (P1-03):
📥 Зафиксировал: «Разобраться с проблемой» (ALPHA-48)
Задача неточная — уточни прямо в приложении.
[✏️ Уточнить ALPHA-48 →]
```

#### 5.1.2 Текстовая задача — команда `/task <текст>`

Тот же пайплайн, что и 5.1.1, без шагов 5–6 (скачивание файла, STT). Начинается сразу с шага 7 (F-04 parse) на `message.text` после снятия префикса `/task `. Фазы 0–1 (реакция + прогресс) сохраняются — F-04 всё равно требует LLM-вызов (1–3с), и пользователь должен видеть, что бот работает, а не тишину в чате.

#### 5.1.3 Текстовая задача — инлайн `@onitask <текст>`

Другая механика по построению — Telegram не даёт делать побочные эффекты в момент ответа на инлайн-запрос, только превью.

1. **`inline_query { id, from, query }`.** Bot отвечает быстро, **без** вызова F-04/LLM:
   ```typescript
   const resultId = crypto.randomUUID();
   await bot.answerInlineQuery(inlineQuery.id, [{
     type: 'article',
     id: resultId,
     title: 'Создать задачу',
     description: query.slice(0, 100),
     input_message_content: {
       message_text: `⏳ Обрабатываю: ${escapeHtml(query)}`,
     },
   }], { cache_time: 0 }); // по умолчанию Telegram кэширует ответ на 300с — результат у нас
   // собирается каждый раз заново под конкретный query, кэшировать нечего и незачем
   ```
   Никакой записи в БД на этом шаге. `resultId` в кэше не нуждается — Telegram сам вернёт исходный `query` на следующем шаге.
2. **Пользователь выбирает результат.** Telegram вставляет в чат сообщение из `input_message_content` и (обязательно, при включённом `/setinlinefeedback 100` в BotFather) шлёт `chosen_inline_result { result_id, from, query, inline_message_id }` на вебхук.
   > Без `/setinlinefeedback 100` часть `chosen_inline_result` не придёт вообще (доставка по умолчанию — сэмплом), и часть задач будет молча теряться: сообщение в чате появится, а задача в БД — нет. Это обязательная настройка, не опция.
3. **Реальная обработка.** F-04 parse на `query`, дальше — резолюция доски (§6.2b), dedup по `dedup_key = 'inline:' + result_id`, insert.
4. **Финализация.** `editMessageText({ inline_message_id, text })` — **не** `chat_id`+`message_id`: у инлайн-сообщений отдельная адресация. `setMessageReaction` здесь неприменим — метод требует `chat_id`+`message_id`, которых для инлайн-сообщения нет.

Естественное следствие такой механики: отдельного «Фаза 1 — прогресс» шага не нужно — то, что пользователь видит сразу после выбора результата («⏳ Обрабатываю: ...», заданное в `input_message_content` на шаге 1), и есть прогресс-плейсхолдер. Финализация просто редактирует его.

#### 5.1.4 Постановка задачи по reply на существующее сообщение

Пользователь отвечает на любое сообщение в чате (своё, чужое, текстовое или голосовое) командой `/task` без аргументов — сообщение превращается в задачу, ничего не надо перепечатывать.

1. **Приём.** `message.reply_to_message` заполнено, `message.text.trim() === '/task'`. Источник сырого текста — не `message.text` (это просто `/task`), а `reply_to_message.text ?? reply_to_message.caption`, либо `reply_to_message.voice`, если реплай сделан на голосовое — в этом случае дальше пайплайн полностью совпадает с 5.1.1 (STT и всё остальное), только источник файла — `reply_to_message.voice.file_id`, а не `message.voice.file_id`.
2. **Group Privacy Mode здесь не проблема.** `/task` — команда, она доходит до бота независимо от `/setprivacy`, даже когда отвечает на чужое, не помеченное упоминанием сообщение. Отдельного caption-триггера, как для голосового форварда (§5.1.1), не требуется.
3. **Уточнение выделенного фрагмента (Quote & Reply).** Если пользователь предварительно выделил часть длинного сообщения и ответил через «Quote», у входящего `message` заполнено поле `quote` (`TextQuote`: `text`, `position`, `entities`, `is_manual`) — берём именно этот фрагмент вместо всего `reply_to_message.text`.
   > ⚠️ У этой механики известна историческая проблема: quote-reply не всегда доставлялся ботам в публичных группах (issue в tdlib/telegram-bot-api, 2023 год). Подтверждения, что починили, на момент написания не нашлось — **проверить на живом тестовом боте в целевом типе чата** перед тем, как полагаться на это в проде. Код ниже уже написан с безопасной деградацией: нет `quote` → берётся `reply_to_message.text` целиком, поведение не ломается.
4. **Dedup, резолюция доски, финализация** — без изменений, по общему пайплайну §6.2/§6.2b. `dedup_key` строится из `chat_id`+`message_id` **самого `/task`-сообщения** (реплая), а не из id исходного сообщения — дедуп защищает именно от повторной доставки команды пользователя, а не от повторной постановки задачи из одного и того же исходного сообщения (это легитимный сценарий: два разных человека могут независимо среагировать на одно и то же сообщение).
5. **Подтверждение** включает автора исходного сообщения: «✅ Задача создана по сообщению Антона: «...»» — контекст не теряется.

```typescript
function extractRawInput(msg: TelegramMessage): { text: string; sourceAuthor?: TelegramUser; voiceFileId?: string } {
  const isReplyTask = msg.reply_to_message && msg.text?.trim() === '/task';
  if (!isReplyTask) {
    return { text: msg.text.replace(/^\/task\s*/, '') }; // §5.1.2, обычная команда
  }
  const original = msg.reply_to_message!;
  if (original.voice) {
    return { voiceFileId: original.voice.file_id, sourceAuthor: original.from, text: '' }; // → пайплайн 5.1.1
  }
  if (msg.quote?.text) {
    return { text: msg.quote.text, sourceAuthor: original.from }; // выделенный фрагмент, если пришёл
  }
  return { text: original.text ?? original.caption ?? '', sourceAuthor: original.from };
}
```

---

### 5.2 Быстрый статус команды (/flow)

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

### 5.3 AI Flow Summary (/summary)

`/summary` вызывает F-03 Cold Path (NeuralDeep Hub · GPT-OSS-120B, Supabase Edge Function).
Результат — текстовая карточка с аномалиями и рекомендацией «кому помочь».
Доступно только на AI Dev / AI Team плане.

> **Feasibility-заметка:** Supabase Edge Function отдаёт 504 при request idle timeout 150с (см. §6.6). Cold Path на GPT-OSS-120B под нагрузкой к этому порогу может подойти. Рекомендация: если p95 латентности `/summary` начинает превышать ~100с, перевести флоу на тот же паттерн, что и голосовая задача — мгновенный ACK («Готовлю сводку…») + результат через очередь `bot_notify`, а не синхронный ответ.

### 5.4 Авто-уведомления (Phase 1.1)

- При перемещении задачи `Inbox → Focus` бот пишет в привязанный чат
- При обнаружении bottleneck / overload — 1 алерт не чаще 1 раза в 2 часа
- Уведомления настраиваются через `workspace_telegram_chats.notification_settings`
- По умолчанию: тихий режим (`on_inbox_move: false`, `on_overload: false`)
- Транспорт — Postgres-триггер → `enrichment_queue` → pg_cron drain-воркер, см. §6.4

### 5.5 Daily Standup (авто-дайджест)

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
- Блок 📥 отображается только при наличии `is_inbox=true AND created_at < NOW() - INTERVAL '24 hours'`. Максимум 3 задачи; каждая — с inline deep link `[уточнить →]` или `[открыть →]` в TWA на конкретную задачу
- **Output sanitization:** все `task.title` и `worker.display_name` экранируются через `escapeHtml()` перед вставкой в шаблон

```typescript
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

Источники данных: `task_column_history` (последние 24ч), вьюхи `stuck_tasks` и `overloaded_workers`. Без LLM — чистый SQL.

Настраивается через `workspace_settings.standup_config`. Только Admin/Owner.
Ручной вызов: `/standup` — тот же дайджест по требованию (Solo план+).

Автоматический вызов по расписанию — через per-workspace tick-cron, см. §6.5.

### 5.6 Вызов задачи по номеру

**Команда:**
```
/task ALPHA-45
```

Бот находит задачу через `find_task_by_full_id('ALPHA-45')` → показывает карточку через `buildTaskCard(card, 'lookup')` (§6.2d, та же функция, что рендерит подтверждение в конце §5.1):

```
📋 ALPHA-45
Настроить CI для frontend
📍 В работе · alpha
👤 Vadim · 🔴 Высокий приоритет
📅 До 2 июня
[Открыть в приложении]
```

```typescript
async function handleTaskLookup(msg: TelegramMessage, fullId: string) {
  const { data: taskId, error } = await supabase.rpc('find_task_by_full_id', {
    p_full_id: fullId,
    p_telegram_user_id: msg.from.id,
  }).single();

  if (error?.code === 'not_found' || !taskId) {
    return bot.api.sendMessage(
      msg.chat.id,
      `Задача ${escapeHtml(fullId)} не найдена. Проверь префикс доски — он указан в настройках workspace.`,
      { parse_mode: 'HTML' },
    );
  }
  if (error?.code === 'forbidden') {
    return bot.api.sendMessage(msg.chat.id, 'У тебя нет доступа к этой доске.');
  }

  const card = buildTaskCard(await getTaskCardData(taskId), 'lookup');
  await bot.api.sendMessage(msg.chat.id, card.text, { parse_mode: 'HTML', reply_markup: card.replyMarkup });
}
```

**Инлайн в чате:**
```
@onitask ALPHA-45
```
Та же карточка, инлайн-ответ в чат. Это read-only сценарий (не создаёт запись), поэтому ограничение из §5.1.3 здесь не применимо — можно смело отдавать карточку прямо в `answerInlineQuery`, без ожидания `chosen_inline_result`:

```typescript
// внутри handleInlineQuery (§5.1.3) — до основной ветки создания задачи
if (FULL_ID_PATTERN.test(inlineQuery.query.trim())) {
  const fullId = inlineQuery.query.trim().toUpperCase();
  const { data: taskId } = await supabase.rpc('find_task_by_full_id', {
    p_full_id: fullId, p_telegram_user_id: inlineQuery.from.id,
  }).single();

  if (!taskId) return bot.answerInlineQuery(inlineQuery.id, [], { cache_time: 0 });

  const card = buildTaskCard(await getTaskCardData(taskId), 'lookup');
  return bot.answerInlineQuery(inlineQuery.id, [{
    type: 'article',
    id: crypto.randomUUID(),
    title: fullId,
    description: card.text.replace(/<[^>]+>/g, '').slice(0, 100),
    input_message_content: { message_text: card.text, parse_mode: 'HTML' },
    reply_markup: card.replyMarkup,
  }], { cache_time: 30 }); // короткий кэш — карточка не создаёт побочных эффектов, в отличие
  // от создания задачи (§5.1.3), где cache_time: 0 обязателен
}
```

**Инлайн-действие (Phase 2):**
```
@onitask ALPHA-45 done
```
Переместить задачу в done (требует прав Member+). Это уже не read-only — значит применима та же механика из §5.1.3: перемещение должно происходить на `chosen_inline_result`, не на `answerInlineQuery`. Зафиксировано как заметка к Phase 2, в Roadmap эта фича ещё не реализуется.

**Обработка ошибок** — уже реализована в `handleTaskLookup` выше: «не найдена» (проверь префикс доски) и «нет доступа» (не участник workspace).

### 5.7 Разрешение эскалации через бот (P1-09, P1-12)

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
3. `enrichment_queue INSERT { type: 'bot_notify', alert_type: 'escalation_resolved', ... }`
4. Ответ оператору: подтверждение + deep link

**Обработка ошибок `/resolve`:**
- Задача не найдена → «Задача ALPHA-45 не найдена»
- `needs_human = false` уже → «Задача ALPHA-45 уже разблокирована»
- Нет прав → «Только участники workspace могут снимать эскалации»

> **Маршрут:** `POST /api/bot/task/:fullId/resolve` — см. §6.1

### 5.8 Онбординг нового пользователя через инвайт (P1-19)

Полный флоу для пользователя, который впервые взаимодействует с ботом через invite-ссылку.

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
        → TWA открывается, initData валидируется на бэкенде и сверяется с worker,
          созданным на Шаге 3
        → Видит пустой или заполненный канбан
```

> **`start` vs `startapp`.** `?start=` открывает чат с ботом и присылает `/start <payload>` — правильный выбор для онбординга по умолчанию, даёт боту обработать edge cases текстом до открытия TWA. `?startapp=` открывает Mini App напрямую, минуя чат, с `payload` в `Telegram.WebApp.initDataUnsafe.start_param` — имеет смысл как второй, короткий путь для уже онбордженных пользователей.
> **Home screen shortcut (Phase 2+, необязательно):** после первого успешного открытия TWA — `Telegram.WebApp.addToHomeScreen()` (Bot API 8.0).

**Edge cases:**
- Пользователь уже состоит в workspace → «Ты уже в @alpha. [Открыть →]»
- Пользователь в другом workspace → добавляется как member во второй, оба остаются активными
- TWA не открывается (старая версия Telegram) → прямая ссылка `https://t.me/onitask_bot/app`

---

## 6. Техническая интеграция

### 6.1 Слой `/api/bot/*` и диспетчеризация update

**Клиентская библиотека.** Весь код ниже (`bot.sendMessage`, `bot.getFile` и т.д.) подразумевает [grammY](https://grammy.dev) — из современных TypeScript Bot API клиентов он лучше всего ложится на serverless/edge: транспорт на `fetch`, нет предположения о постоянном long-polling процессе, официальный webhook-адаптер под Next.js Route Handlers (`hono`/`std/http`-совместимый), актуальные типы под свежие методы Bot API (в т.ч. `quote` в `Message`, `setMessageReaction`). Альтернатива — `node-telegram-bot-api`, но она исторически ориентирована на long-polling и потребует больше ручной работы под serverless-вебхук.

Bot использует существующие эндпоинты через service token с ролью `bot`. Маршруты:

```
POST /api/bot/webhook               — единая точка входа для ВСЕХ типов Telegram update
POST /api/bot/task                  — создание задачи из бота (адаптер над F-04)
GET  /api/bot/flow/:workspaceId     — сбор Flow Metrics для /flow
GET  /api/bot/standup/:workspaceId  — сбор данных для /standup (ручной вызов)
GET  /api/bot/task/:fullId          — резолюция ALPHA-123 → карточка задачи
POST /api/bot/task/:fullId/resolve  — снять needs_human, уведомить агента (§5.7)
POST /api/bot/notify                — постановка сообщения в очередь bot_notify (см. §6.4)
```

Telegram шлёт все типы событий (`message`, `inline_query`, `chosen_inline_result`, `callback_query`) на один и тот же `setWebhook`-URL — маршрутизация по типу происходит внутри хендлера:

```typescript
const FULL_ID_PATTERN = /^([A-Za-z]+-\d+)$/;

async function handleUpdate(update: TelegramUpdate) {
  const msg = update.message;
  const lookupMatch = msg?.text?.match(/^\/task\s+([A-Za-z]+-\d+)$/);

  if (msg?.voice)                                            return handleVoiceTask(msg);                     // §5.1.1
  if (msg?.reply_to_message && msg.text?.trim() === '/task')  return handleReplyTask(msg);                     // §5.1.4
  if (lookupMatch)                                            return handleTaskLookup(msg, lookupMatch[1].toUpperCase()); // §5.6, НЕ создание
  if (msg?.text?.startsWith('/task '))                        return handleTextTask(msg);                      // §5.1.2
  if (update.inline_query)                                    return handleInlineQuery(update.inline_query);   // §5.1.3/§5.6
  if (update.chosen_inline_result)                            return handleChosenInlineResult(update.chosen_inline_result); // §5.1.3, шаг 2+
  if (update.callback_query?.data?.startsWith('wschoice:'))   return handleWorkspaceChoice(update.callback_query); // §6.2b
  // ... остальные команды (/flow, /standup, /resolve, ...)
}
```

> **Баг, найденный при добавлении карточки задачи (v0.6.4):** без ветки `lookupMatch` выражение `/task ALPHA-45` проваливалось в `handleTextTask` — бот пытался создать новую задачу из текста «ALPHA-45» вместо того, чтобы показать карточку существующей. Проверка на `FULL_ID_PATTERN` обязана идти раньше общей `/task <текст>`.

Порядок проверок важен: reply-ветка (§5.1.4) и lookup-ветка должны идти раньше обычной `/task <текст>` — иначе они никогда не сработают, `handleTextTask` перехватит их первым.

**Секретный токен вебхука.**

```typescript
await bot.setWebhook(WEBHOOK_URL, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ['message', 'inline_query', 'chosen_inline_result', 'callback_query'],
});
```

### 6.1a Настройка бота вне кода (обязательно перед запуском)

Часть флоу физически не заработает без правильной конфигурации в BotFather/через API — это не код, поэтому легко упустить при ревью PR. Чеклист:

| Что настроить | Как | Зачем | Если забыть |
|---|---|---|---|
| Group Privacy Mode | BotFather → `/setprivacy` → **Enable** | Бот в группе видит только команды, reply на себя и явные упоминания — не весь трафик (§5.1) | Либо бот не видит вообще ничего в группе (если код на это не рассчитан), либо, при Disable, видит всё — то есть прямо противоположно тому, что заложено в архитектуру приватности |
| Inline feedback | BotFather → `/setinlinefeedback` → **100** | `chosen_inline_result` обязателен для создания задачи через `@onitask` (§5.1.3) | По умолчанию доставляется сэмплом — часть задач из инлайна молча теряется |
| Список команд | `setMyCommands` (Bot API, не BotFather) при деплое | Автокомплит команд из §2 в интерфейсе Telegram при вводе `/` | Команды технически работают, но пользователь их не увидит и не угадает |
| Menu Button → TWA | `setChatMenuButton({ menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: TWA_URL } } })` | Кнопка слева от поля ввода открывает TWA в один тап, без `/flow` и без диплинков | Единственный способ попасть в TWA — deep link из ответа бота, лишний шаг на каждый заход |
| Webhook | `setWebhook` с `secret_token` + `allowed_updates` (см. выше) | §6.1 | Вебхук либо не защищён, либо не получает нужные типы update |

```typescript
await bot.api.setMyCommands([
  { command: 'task', description: 'Создать задачу текстом или голосом' },
  { command: 'inbox', description: 'Показать Inbox' },
  { command: 'flow', description: 'Статус Flow Board' },
  { command: 'standup', description: 'Дайджест команды' },
  { command: 'resolve', description: 'Снять эскалацию: /resolve ALPHA-123' },
  { command: 'help', description: 'Список команд' },
  // /summary, /who, /load, /stuck, /review — по желанию, полный список см. §2
]);

await bot.api.setChatMenuButton({
  menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: process.env.TWA_URL! } },
});
```

```typescript
// app/api/bot/webhook/route.ts
export const maxDuration = 60; // Fluid compute; поднять до 120–300 при необходимости, см. §6.6

export async function POST(req: Request) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const update = await req.json();
  after(() => handleUpdate(update).catch((err) => logBotError(update, err)));
  return new Response('ok', { status: 200 });
}
```

Повторная доставка update (медленный ACK при холодном старте, сетевые ретраи Telegram) — ожидаемое поведение. Единственная надёжная защита от двойной обработки — атомарность на уровне БД (§6.2), а не скорость ответа хендлера.

### 6.2 Общий пайплайн F-04: dedup, ошибки, резолюция доски

Все три точки входа (§5.1.1–5.1.3) сходятся в одном и том же наборе примитивов после того, как получен сырой текст (транскрибированный или прямой).

#### Обобщённый dedup-ключ

Было (v0.6.0): unique index по голому `metadata->>'message_id'` — баг, `message_id` уникален только **внутри чата**, а не глобально; два разных чата легко порождают одинаковый `message_id` для двух разных легитимных задач. Стало:

```sql
create unique index if not exists tasks_bot_dedup_idx
  on tasks ((metadata->>'dedup_key'))
  where metadata->>'source' in ('telegram_bot', 'telegram_inline');
```

```typescript
type MessageLocator =
  | { type: 'chat'; chatId: number; messageId: number; threadId?: number } // threadId — forum topics, см. §5.1
  | { type: 'inline'; resultId: string; inlineMessageId: string };
  // ⚠️ resultId и inlineMessageId — разные идентификаторы, оба приходят в chosen_inline_result
  // одновременно (§5.1.3). resultId используется для dedup_key (мы сами его сгенерировали и
  // контролируем уникальность), inlineMessageId — обязателен для editMessageText/editWherever,
  // это адрес сообщения в чате, а не идентификатор результата инлайн-запроса.

function computeDedupKey(locator: MessageLocator): string {
  return locator.type === 'chat'
    ? `msg:${locator.chatId}:${locator.messageId}`
    : `inline:${locator.resultId}`;
}

async function createTask(locator: MessageLocator, parsed: ParsedTask) {
  const dedupKey = computeDedupKey(locator);
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      column: 'backlog',
      is_inbox: true,
      description: parsed.rewritten_description || parsed.raw_input,
      workspace_id: parsed.target_workspace_id,
      assigned_to: parsed.assignee_id ?? null,
      metadata: {
        source: locator.type === 'chat' ? 'telegram_bot' : 'telegram_inline',
        dedup_key: dedupKey,
        source_author: parsed.sourceAuthor ?? null, // заполнено для reply-флоу, §5.1.4
        ...locator,
      },
    })
    .select('id')
    .single();

  if (error?.code === '23505') {
    // Дубль — но у пользователя есть право увидеть карточку уже существующей задачи,
    // а не голый текст «уже зафиксирована». Карточка (§6.2d) переиспользуется и здесь.
    const { data: existing } = await supabase.from('tasks').select('id').eq('metadata->>dedup_key', dedupKey).single();
    return { duplicate: true as const, card: await getTaskCardData(existing!.id) };
  }
  if (error) throw error;
  return { duplicate: false as const, card: await getTaskCardData(data!.id) };
}
```

> `getTaskCardData()` и `TaskCardData` — см. §6.2d ниже, порядок в файле обратный порядку вызова, но `async function` в TS/JS hoisted, так что реальному коду это не мешает.

Скачивание файла (только для 5.1.1):

```typescript
async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const { file_path, file_size } = await bot.getFile(fileId);
  if (file_size && file_size > 20 * 1024 * 1024) {
    throw new BotError('FILE_TOO_LARGE', 'Файл больше 20 МБ — Bot API не даст его скачать. Пришли короче или напиши текстом.');
  }
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file_path}`);
  return Buffer.from(await res.arrayBuffer());
}
```

#### STT Error Matrix — два уровня (P1-02, уточнено в v0.6.1)

Раньше все ошибки STT схлопывались в один fallback «title = raw_input» — некорректно для случаев, когда транскрипта ещё не существует. Разделено:

**Уровень 1 — ошибка распознавания, транскрипта нет:**

| Тип ошибки | Условие | Действие | Сообщение пользователю |
|---|---|---|---|
| Файл слишком большой | `file_size > 20 МБ` | Задача **не создаётся** | «Файл больше 20 МБ — Telegram не даёт боту его скачать. Пришли короче или напиши текстом.» |
| Сетевая ошибка при скачивании/STT | `NetworkError`/`ECONNRESET` | 1 тихий retry через 2с, затем задача **не создаётся** | «Не удалось распознать — попробуй ещё раз.» |
| Groq timeout / offline (5xx) | ответ > 8с или HTTP 500–503 | Задача **создаётся с заглушкой** — сигнал не теряется, даже если мы не смогли его разобрать | «⚠️ Не удалось распознать голосовое — задача создана как есть, уточни в приложении.» Task: `title = '🎤 Голосовое сообщение'`, tag `voice-unrecognized`, `is_inbox = true` |
| Пустой транскрипт (тишина) | `text === ''` после успешного STT | Задача **не создаётся** — распознавание сработало и честно вернуло «ничего не сказано» | «Не удалось разобрать аудио — попробуй ещё раз или напиши текстом.» |

**Уровень 2 — транскрипт есть, ошибка на F-04 parse (LLM-рерайт):**

| Тип ошибки | Условие | Действие | Сообщение пользователю |
|---|---|---|---|
| Groq LLM timeout / offline | ответ > таймаута или 5xx | Задача создаётся, `title` = сырой транскрипт (это и есть корректный смысл `raw_input` — то, что реально сказал пользователь, без AI-рерайта) | «⚠️ AI-обработка недоступна — задача создана как есть. Уточни в приложении.» |

Разница принципиальная: на уровне 1 при технической ошибке распознавания мы всё равно создаём задачу-заглушку, чтобы не потерять факт обращения пользователя — кроме случая настоящей тишины, когда создавать действительно нечего. На уровне 2 у нас уже есть честный текст пользователя, и `raw_input` как fallback-заголовок — не костыль, а осмысленный запасной путь.

При создании из бота обязательно записывать в `tasks.metadata`:

```json
{
  "source": "telegram_bot",
  "dedup_key": "msg:-1001234567890:42",
  "chatId": -1001234567890,
  "messageId": 42,
  "target_workspace": "alpha"
}
```

#### Вспомогательные функции пайплайна

Код в 5.1.1–5.1.4 и §6.2b ссылается на них, но ни разу не показывает реализацию — закрываем пробел.

```typescript
class BotError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function logBotError(update: TelegramUpdate, err: unknown) {
  console.error('[bot]', JSON.stringify({ updateId: update.update_id, err: String(err) }));
  // В проде — тот же канал логирования, что и остальной backend (Sentry/Logflare), не отдельный
}

// Groq Whisper — STT Error Matrix, уровень 1 (§6.2). AbortController = таймаут 8с.
async function transcribe(file: Buffer): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await groq.audio.transcriptions.create(
      { file: new File([file], 'voice.ogg'), model: 'whisper-large-v3-turbo' },
      { signal: controller.signal },
    );
    return res.text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// F-04 Instant Parse — STT Error Matrix, уровень 2 (§6.2). workspace_context и список
// участников передаются в system-промпт, как и в TWA-path (§6.2 «Адаптация F-04»).
async function parseTask(rawText: string, workspaceContext: WorkspaceContext): Promise<ParsedTask> {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildF04SystemPrompt(workspaceContext) },
      { role: 'user', content: rawText },
    ],
  });
  return JSON.parse(res.choices[0].message.content!);
  // rewritten_title, rewritten_description, clarity_score, assignee, deadline, target_workspace
}

// Резолюция доски, приоритеты 1–5 из §3. Приоритеты 2–4 (chat binding / @workspace в тексте /
// target_workspace из F-04) проверяются в вызывающем коде до этой функции — им нужен контекст
// (сам chat, сырой текст), которого здесь уже нет. Эта функция закрывает только 1 и 5.
async function getCandidateWorkspaces(telegramUserId: number): Promise<
  | { resolved: true; workspaceId: string }
  | { resolved: false; workspaceIds: string[]; names: Record<string, string> }
> {
  const memberships = await supabase.rpc('get_user_workspaces', { telegram_user_id: telegramUserId });
  if (memberships.length === 1) return { resolved: true, workspaceId: memberships[0].id }; // приоритет 1

  const lastUsed = await supabase.rpc('get_last_used_workspace', { telegram_user_id: telegramUserId }); // приоритет 5, SQL — §3
  if (lastUsed) return { resolved: true, workspaceId: lastUsed };

  return {
    resolved: false,
    workspaceIds: memberships.map((m) => m.id),
    names: Object.fromEntries(memberships.map((m) => [m.id, m.display_name])),
  };
}

**Контракт экранирования (важно, был баг в v0.6.2).** `escapeHtml()` вызывается ровно один раз — в билдер-функциях ниже, в момент вставки пользовательских данных (title, имя автора, текст ошибки) в HTML-шаблон. `finalize()`/`editWherever()` получают уже готовую, безопасную строку и передают её в Bot API как есть, `parse_mode: 'HTML'`, без повторного экранирования. Раньше `finalize()` экранировал весь составленный текст ещё раз поверх уже экранированного `buildConfirmation()` — `&` в названии задачи превращался в `&amp;amp;` и отображался буквально пользователю. Обрезка длины (`truncateForTelegram`) по той же причине применяется к сырому полю **до** экранирования и **до** оборачивания в теги — обрезать уже готовую HTML-строку означает риск разрезать `<b>`/`&amp;` пополам и получить от Bot API `400: can't parse entities`.

```typescript
const TELEGRAM_MESSAGE_LIMIT = 4096; // жёсткий лимит Bot API на текст sendMessage/editMessageText
const CARD_TITLE_LIMIT = 300;        // заголовок карточки — одна строка, не весь лимит сообщения

function truncateForTelegram(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
}

function buildErrorMessage(err: unknown): string {
  if (err instanceof BotError) return `⚠️ ${escapeHtml(err.message)}`;
  return '⚠️ Что-то пошло не так — попробуй ещё раз или напиши в приложении напрямую.';
}
```

> `buildConfirmation`/`buildReplyMarkup` из v0.6.2/v0.6.3 объединены в одну функцию — `buildTaskCard()`, см. §6.2d. Причина: раньше подтверждение при создании и карточка при `/task ALPHA-45` (§5.6) были двумя независимыми, визуально разными кусками текста, хотя показывают один и тот же набор данных о задаче. `buildErrorMessage` остаётся здесь — это не про задачу, а про ошибку пайплайна.

```typescript
// Единая точка редактирования и для §6.2b (клавиатура выбора доски), и для финализации §5.1.3.
// text уже безопасный, обрезанный HTML — см. контракт экранирования выше. Не путать с finalize()
// ниже — та отдельно реализует Rich Message capability latch и sendMessage-фоллбек, что здесь
// не нужно (клавиатура выбора доски — всегда простой HTML без форматирования).
async function editWherever(locator: MessageLocator, text: string, replyMarkup?: unknown) {
  const opts = { parse_mode: 'HTML' as const, reply_markup: replyMarkup };
  if (locator.type === 'chat') {
    return bot.api.editMessageText(locator.chatId, locator.messageId, text, opts);
  }
  return bot.api.editMessageTextInline(locator.inlineMessageId, text, opts);
}
```

#### Трёхфазный ответ (голос, §5.1.1) — реализация

```typescript
async function handleVoiceTask(msg: TelegramMessage) {
  await bot.setMessageReaction(msg.chat.id, msg.message_id, [{ type: 'emoji', emoji: '👀' }]).catch(() => {});

  const progressId = await sendProgress(msg.chat.id, 'Обрабатываю голосовое…');

  try {
    const file = await downloadTelegramFile(msg.voice.file_id);
    const transcript = await transcribe(file); // Groq Whisper, уровень 1 ошибок внутри
    // На этом шаге workspace ещё не резолвнут (см. §3, приоритет 4 — сам F-04 может его извлечь
    // из речи), поэтому workspaceContext — объединённый контекст всех workspace, где состоит
    // пользователь, а не одного конкретного. Не идеально для сопоставления исполнителей по
    // имени при неоднозначности между досками, но для MVP достаточно — уточняется в TWA.
    const workspaceContext = await getWorkspaceContextHint(msg.from.id);
    const parsed = await parseTask(transcript, workspaceContext); // F-04, уровень 2 ошибок внутри

    const resolution = await resolveWorkspace(parsed, msg.from.id); // §6.2b
    if (resolution.type === 'pending') {
      // клавиатура уже отправлена внутри resolveWorkspace — на этом вызов заканчивается
      return;
    }

    const locator: MessageLocator = { type: 'chat', chatId: msg.chat.id, messageId: msg.message_id };
    const result = await createTask(locator, { ...parsed, target_workspace_id: resolution.workspaceId });

    const card = buildTaskCard(result.card, result.duplicate ? 'duplicate' : 'created'); // §6.2d
    await finalize(msg.chat.id, progressId, card.text, card.replyMarkup);
    if (!result.duplicate) {
      await bot.setMessageReaction(msg.chat.id, msg.message_id, [{ type: 'emoji', emoji: '✅' }]).catch(() => {});
    }
  } catch (err) {
    await finalize(msg.chat.id, progressId, buildErrorMessage(err));
    await bot.setMessageReaction(msg.chat.id, msg.message_id, []).catch(() => {});
  }
}

let richMessagesDisabled = false; // capability latch — живёт в памяти инстанса, не переживает cold start

async function sendProgress(chatId: number, text: string): Promise<number> {
  if (!richMessagesDisabled) {
    try {
      const draft = await bot.sendRichMessageDraft(chatId, richParagraph(text)); // сверить сигнатуру с Bot API 10.1
      return draft.message_id;
    } catch {
      richMessagesDisabled = true;
    }
  }
  const fallback = await bot.sendMessage(chatId, `⏳ ${text}`);
  return fallback.message_id;
}

async function finalize(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
  // text уже безопасный HTML из buildTaskCard/buildErrorMessage — см. контракт выше,
  // повторный escapeHtml() здесь был багом v0.6.2 (двойное экранирование ломало <b> и &amp;)
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: replyMarkup });
  } catch {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: replyMarkup });
  }
}
```

> Rich Messages (Bot API 10.1, вышли 11 июня 2026) держим за фича-флагом `BOT_RICH_MESSAGES_ENABLED` с capability latch и обязательным HTML-fallback — API совсем свежий, у сторонних адаптеров уже есть баги рендеринга в части клиентов. In-memory флаг не переживает cold start Vercel-инстанса — для MVP это не критично (флаг по умолчанию выключен), но при включении в проде стоит вынести статус в общее хранилище (Supabase-строка / Edge Config), а не держать per-instance.

### 6.2b Резолюция доски: синхронная и асинхронная ветки

```sql
create table bot_pending_drafts (
  id                      uuid primary key default gen_random_uuid(),
  -- ровно один из двух способов адресации обязан быть заполнен:
  chat_id                 bigint,
  message_id              bigint,
  inline_message_id       text,
  result_id               text,   -- нужен только вместе с inline_message_id — для dedup_key при
                                   -- финальном createTask() в handleWorkspaceChoice, см. ниже
  telegram_user_id        bigint not null,
  draft                   jsonb not null,        -- результат F-04: title, description, clarity_score, assignee_id...
  candidate_workspace_ids uuid[] not null,
  status                  text not null default 'pending', -- pending | claimed | expired
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null default now() + interval '10 minutes',
  constraint one_locator check (
    (chat_id is not null and message_id is not null and inline_message_id is null)
    or (chat_id is null and message_id is null and inline_message_id is not null)
  )
);
```

```typescript
async function resolveWorkspace(parsed: ParsedTask, telegramUserId: number) {
  const candidates = await getCandidateWorkspaces(telegramUserId); // приоритеты 1–5, §3

  if (candidates.resolved) {
    return { type: 'resolved' as const, workspaceId: candidates.workspaceId };
  }

  // Приоритет 6 — неоднозначно, сохраняем черновик и спрашиваем
  const { data: draft } = await supabase.from('bot_pending_drafts').insert({
    chat_id: parsed.locator.type === 'chat' ? parsed.locator.chatId : null,
    message_id: parsed.locator.type === 'chat' ? parsed.locator.messageId : null,
    inline_message_id: parsed.locator.type === 'inline' ? parsed.locator.inlineMessageId : null,
    result_id: parsed.locator.type === 'inline' ? parsed.locator.resultId : null,
    telegram_user_id: telegramUserId,
    draft: parsed,
    candidate_workspace_ids: candidates.workspaceIds,
  }).select().single();

  const keyboard = candidates.workspaceIds.map((id) => [{
    text: candidates.names[id],
    callback_data: `wschoice:${draft.id}:${id}`,
  }]);
  await editWherever(parsed.locator, 'В какую доску добавить задачу?', { inline_keyboard: keyboard });

  return { type: 'pending' as const };
}

async function claimDraft(draftId: string, workspaceId: string) {
  const { data, error } = await supabase
    .from('bot_pending_drafts')
    .update({ status: 'claimed' })
    .eq('id', draftId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select()
    .single();

  if (error || !data) return null; // уже забран, протух, или не найден
  return data;
}

async function handleWorkspaceChoice(cq: TelegramCallbackQuery) {
  const [, draftId, workspaceId] = cq.data.split(':');
  const draft = await claimDraft(draftId, workspaceId);

  if (!draft) {
    await bot.answerCallbackQuery(cq.id, { text: 'Уже обработано или устарело — пришли ещё раз' });
    return;
  }

  // Было (v0.6.2, баг): { type: 'inline', resultId: draft.inline_message_id } — подставляло
  // inline_message_id в поле resultId, dedup_key для итоговой задачи получался неверным.
  const locator: MessageLocator = draft.inline_message_id
    ? { type: 'inline', resultId: draft.result_id, inlineMessageId: draft.inline_message_id }
    : { type: 'chat', chatId: draft.chat_id, messageId: draft.message_id };

  const result = await createTask(locator, { ...draft.draft, target_workspace_id: workspaceId });
  await bot.answerCallbackQuery(cq.id); // обязательно — иначе кнопка у пользователя виснет в лоадере
  const card = buildTaskCard(result.card, result.duplicate ? 'duplicate' : 'created'); // §6.2d
  await editWherever(locator, card.text, card.replyMarkup);
}
```

**Очистка просроченных клавиатур (исчезающие сообщения).** Раньше протухший черновик обрабатывался только реактивно — пользователь кликает кнопку, получает «устарело». Мёртвая, нерабочая клавиатура при этом продолжала висеть в чате, пока кто-то её не нажмёт. Проактивная очистка по расписанию — тот же pg_cron-паттерн, что и в §6.4/§6.5:

```sql
select cron.schedule(
  'expire-pending-drafts',
  '1 minute',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/expire-pending-drafts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))
  );
  $$
);
```

```typescript
// supabase/functions/expire-pending-drafts/index.ts
Deno.serve(async () => {
  const { data: expired } = await supabase
    .from('bot_pending_drafts')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select();

  for (const draft of expired ?? []) {
    const locator: MessageLocator = draft.inline_message_id
      ? { type: 'inline', resultId: draft.result_id, inlineMessageId: draft.inline_message_id }
      : { type: 'chat', chatId: draft.chat_id, messageId: draft.message_id };
    // reply_markup: undefined убирает клавиатуру — кнопки, ведущие в никуда, хуже отсутствия кнопок
    await editWherever(locator, '⏳ Черновик устарел — отправь голосовое или текст ещё раз', undefined).catch(() => {});
  }
  return new Response('ok');
});
```

Ключевые проектные решения:
- **Черновик персистится, а не держится в памяти вызова** — вебхук-инвокейшн не должен «спать» в ожидании клика, который может занять секунды или минуты; это либо упрётся в лимит длительности функции, либо просто впустую тратит compute.
- **Claim атомарен** (`UPDATE ... WHERE status = 'pending' ... RETURNING`), той же техникой, что и dedup задач — двойной тап по кнопке или повторная доставка `callback_query` не создают две задачи.
- **`answerCallbackQuery` обязателен** — без него кнопка у пользователя виснет в состоянии загрузки, даже если карточка задачи уже успешно отредактирована.
- **TTL 10 минут** — истёкший черновик не клеймится (`expires_at` в условии `claimDraft`), пользователю предлагается повторить голосовое/текст.

### 6.2c Оформление, тон и жизненный цикл сообщений

Сводная таблица — чтобы новые сообщения бота (Phase 1.1+) добавлялись в существующий стиль, а не изобретались каждый раз заново.

| Эмодзи-префикс | Категория | Тон | Где используется |
|---|---|---|---|
| ✅ | Успех, действие завершено | Коротко, факт, без лишних слов | Задача создана, эскалация снята |
| 📥 | Нужно внимание пользователя, но не ошибка | Нейтрально + конкретный next step | Low-clarity задача, inbox-дайджест |
| ⚠️ | Восстановимая ошибка / деградация | Признать проблему + что сделано взамен + что делать пользователю | STT/LLM недоступен, файл не подошёл |
| 🆘 | Требует решения человека, блокирует агента | Кратко: что, почему, что предлагается | Эскалация (§5.7) |
| 👋 | Первый контакт | Тепло, коротко, сразу три первых шага | Онбординг (§5.8) |
| ⏳ | Промежуточное состояние, не финал | Минимум слов — это временное сообщение | Фаза 1 прогресс, просроченный черновик |

Общие правила формулировок:
- **Обращение на «ты»** — везде, без исключений (это уже так во всех примерах документа, здесь фиксируется как явное решение, а не случайность).
- **Никогда не «TWA» в пользовательской копии.** TWA (Telegram Web App) — внутренний технический термин; пользователь видит «приложение» или «Открыть в приложении». В коде и прозе документа «TWA» продолжает использоваться как есть — путаницы это не создаёт, потому что разработчик и есть целевая аудитория этого файла.
- **Ошибка = проблема + текущий результат + следующий шаг**, в этом порядке. Не просто «что-то сломалось» — что бот сделал взамен (создал заглушку / использовал сырой текст) и что делать дальше.
- **Экранирование — один раз, в билдер-функции, в момент вставки данных** (§6.2, было исправлено). `finalize()`/`editWherever()` доверяют входящему тексту, не трогают его повторно.
- **Обрезка длины — на сыром поле, до экранирования и до оборачивания в теги** (`truncateForTelegram`, §6.2) — обрезка готовой HTML-строки рискует разрезать тег или entity пополам и получить `400` от Bot API.

### 6.2d Карточка задачи: рендер и переиспользование

Один и тот же рендер карточки используется в двух местах: в конце флоу постановки задачи (§5.1) и при вызове задачи по номеру (§5.6, `/task ALPHA-45` и `@onitask ALPHA-45`). Раньше это были два независимых куска текста, хотя показывают один и тот же набор данных — здесь сведены в одну функцию.

**Источник данных.** Ни INSERT (`createTask`, §6.2), ни сырая строка `tasks` не содержат имя исполнителя или короткое имя доски — это джойны на `workers`/`workspaces`. Чтобы не дублировать джойн в каждом месте, где нужна карточка, — общая RPC:

```sql
create or replace function get_task_card_data(p_task_id uuid)
returns table (
  full_id text, title text, "column" text, is_inbox boolean, is_blocked boolean,
  priority text, due_date date, assignee_name text, workspace_handle text, clarity_score numeric
) language sql stable as $$
  select
    t.full_id,
    coalesce(t.metadata->>'rewritten_title', left(t.description, 100)),
    t.column, t.is_inbox, t.is_blocked, t.priority, t.due_date,
    w.display_name, ws.handle,
    (t.metadata->>'clarity_score')::numeric
  from tasks t
  left join workers w on w.id = t.assigned_to
  join workspaces ws on ws.id = t.workspace_id
  where t.id = p_task_id;
$$;
```

```typescript
type TaskCardData = {
  fullId: string; title: string; column: string; isInbox: boolean; isBlocked: boolean;
  priority: 'high' | 'medium' | 'low' | null; dueDate: string | null;
  assigneeName: string | null; workspaceHandle: string; clarityScore: number | null;
};

async function getTaskCardData(taskId: string): Promise<TaskCardData> {
  const { data } = await supabase.rpc('get_task_card_data', { p_task_id: taskId }).single();
  return data as TaskCardData;
}

function isLowClarity(card: TaskCardData): boolean {
  return card.clarityScore != null && card.clarityScore < LOW_CLARITY_THRESHOLD;
}
```

**Рендер.** `<blockquote>` (Bot API 7.0, конец 2023 — в отличие от Rich Messages это давно обкатанная возможность, без capability latch) даёт визуально выделенный «карточный» блок под заголовком без сторонних библиотек:

**Кнопка ведёт в Mini App, а не в браузер (найдено при ревью пользователем).** `InlineKeyboardButton.web_app` дал бы настоящий `initData`, но по спецификации Bot API доступен только в приватных чатах с ботом — в группах, где живёт весь флоу §5.1, такая кнопка не работает. Простой `url: "https://onitask.app/..."` тоже не годится — откроет страницу во внешнем браузере, без `Telegram.WebApp` и без `initData`, на которые опирается авторизация. Рабочий вариант — Direct Link Mini App: `https://t.me/<bot>/<app>?startapp=<param>` как обычный `url` кнопки. Telegram сам распознаёт этот формат и открывает Mini App (не браузер) в любом чате, включая группы, прокидывая `<param>` в `initDataUnsafe.start_param`. Допустимые символы — `A-Z a-z 0-9 _ -`, до 512 символов. Поскольку `find_task_by_full_id` и так резолвит задачу по одному `full_id` в контексте пользователя, отдельно кодировать `workspaceHandle` в `start_param` избыточно — `full_id` уже `{PREFIX}-{номер}`, целиком укладывается в допустимый набор символов:

```typescript
const BOT_USERNAME = 'onitask_bot';
const MINI_APP_SHORT_NAME = 'app'; // тот же short name, что и в фоллбек-ссылке §5.8 (t.me/onitask_bot/app)

function miniAppDeepLink(startParam?: string): string {
  const base = `https://t.me/${BOT_USERNAME}/${MINI_APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}
```

На стороне Mini App читаем `start_param` напрямую через официальный `window.Telegram.WebApp` (из `telegram-web-app.js`) — сознательно не через npm-обёртки вроде `@telegram-apps/sdk`: у той было минимум одно ломающее изменение между мажорными версиями (в v3 убрали хук `useLaunchParams`, бывший в v2), а `window.Telegram.WebApp` — часть официального, поддерживаемого самим Telegram API, и не зависит от версии стороннего пакета. Обязательно нести `initData` в запрос на бэкенд — иначе сервер не знает, кто спрашивает и есть ли у него доступ к этой доске (§5.8: initData валидируется на бэкенде и сверяется с worker):

```typescript
// TWA frontend, на старте приложения
const tg = window.Telegram?.WebApp;
const match = tg?.initDataUnsafe?.start_param?.match(/^task_([A-Za-z]+-\d+)$/);
if (match) {
  // initDataRaw — тем же способом, что твой TWA уже аутентифицирует остальные вызовы к
  // своему backend (Route Handler, service token); здесь ничего нового не вводится
  const task = await fetch(`/api/tasks/${match[1]}`, {
    headers: { Authorization: `tma ${tg.initData}` },
  }).then((r) => r.json());
  router.push(`/workspace/${task.workspaceHandle}?task=${task.fullId}`);
}
```

```typescript
const STATUS_LABELS: Record<string, string> = {
  in_progress: 'В работе', review: 'На проверке', done: 'Готово', backlog: 'Бэклог',
};
const PRIORITY_LABELS: Record<string, string> = {
  high: '🔴 Высокий приоритет', medium: '🟡 Средний приоритет', low: '🟢 Низкий приоритет',
};

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(dueDate));
}

function taskUrl(card: TaskCardData): string {
  return miniAppDeepLink(`task_${card.fullId}`); // "task_ALPHA-45" — только [A-Za-z0-9_-], в лимите 512 символов
}

function renderTaskCardBody(card: TaskCardData): string {
  const status = card.isInbox ? 'Inbox' : (STATUS_LABELS[card.column] ?? card.column);
  const title = escapeHtml(truncateForTelegram(card.title, CARD_TITLE_LIMIT));

  const lines = [`📍 ${status} · ${escapeHtml(card.workspaceHandle)}`];

  const assignee = card.assigneeName ? escapeHtml(card.assigneeName) : 'Не назначено';
  const priority = card.priority ? PRIORITY_LABELS[card.priority] : null;
  lines.push(`👤 ${assignee}${priority ? ` · ${priority}` : ''}`);

  const due = formatDueDate(card.dueDate);
  if (due) lines.push(`📅 До ${due}`);
  if (card.isBlocked) lines.push('⛔ Заблокировано');
  if (isLowClarity(card)) lines.push('⚠️ Формулировка неточная — уточни в приложении');

  return `📋 <b>${card.fullId}</b>\n<blockquote>${title}</blockquote>\n${lines.join('\n')}`;
}

function buildTaskCard(card: TaskCardData, context: 'created' | 'duplicate' | 'lookup') {
  const header = { created: '✅ Задача создана', duplicate: '✅ Уже зафиксирована', lookup: null }[context];
  const text = header ? `${header}\n${renderTaskCardBody(card)}` : renderTaskCardBody(card);

  const primaryButton = isLowClarity(card)
    ? { text: `✏️ Уточнить ${card.fullId} →`, url: taskUrl(card) }
    : { text: 'Открыть в приложении', url: taskUrl(card) };

  return { text, replyMarkup: { inline_keyboard: [[primaryButton]] } };
}
```

Пример вывода (`context: 'lookup'`, `/task ALPHA-45`):

```
📋 ALPHA-45
Настроить CI для frontend        ← визуально в рамке blockquote
📍 В работе · alpha
👤 Vadim · 🔴 Высокий приоритет
📅 До 2 июня
[Открыть в приложении]
```

Пример вывода (`context: 'created'`, low-clarity):

```
✅ Задача создана
📋 ALPHA-48
Разобраться с проблемой          ← визуально в рамке blockquote
📍 Inbox · alpha
👤 Не назначено
⚠️ Формулировка неточная — уточни в приложении
[✏️ Уточнить ALPHA-48 →]
```

Заголовок (`created`/`duplicate`/`lookup`) и низкая ясность (⚠️-строка + кнопка «Уточнить») — единственное, что меняется между тремя контекстами использования; тело карточки, статусы, приоритеты и кнопка «Открыть в приложении» — всегда одна и та же функция, один и тот же визуальный язык.

> Тот же баг (обычный `url` вместо Direct Link Mini App) вероятно есть везде, где в документе фигурирует «deep link в TWA» текстом без кода — «Открыть Flow Board» (§5.3, §5.8), «Открыть задачу →» в эскалации (§5.7). Везде, где кнопка должна открывать Mini App, а не просто ссылку — использовать `miniAppDeepLink()`, не собирать URL на `TWA_URL` вручную. По аналогии для Flow Board: `miniAppDeepLink('flow_' + workspaceHandle)`.

---

### 6.3 Расширение F-06 (MCP Agent Router)

Инструмент `send_message_to_chat` для уведомлений из агентских сценариев (зарегистрирован в `agent_events.tool` CHECK — см. [Master Spec 6.1](onitask_Architecture_Master_.md#61-изменения-существующих-таблиц)):

```typescript
{
  tool: 'send_message_to_chat',
  params: { chat_id: bigint, text: string, parse_mode: 'HTML' }
}
```

**Output sanitization (LLM-5, OWASP LLM Top 10):**

```typescript
import sanitizeHtml from 'sanitize-html';

export function sanitizeOutput(text: string, target: 'tg'): string {
  return sanitizeHtml(text, {
    allowedTags: ['b', 'i', 'u', 's', 'code', 'pre'],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}
```

Ссылка на полный контракт sanitization — [mcp_contract_.md §4 send_message_to_chat](onitask_mcp_contract_.md#send_message_to_chat).

### 6.4 Асинхронные уведомления: Postgres-триггер → очередь → pg_cron-воркер

**1. Триггер пишет в очередь при переходе `Inbox → Focus`:**

```sql
create or replace function notify_bot_on_inbox_move() returns trigger as $$
begin
  if old.column = 'backlog' and old.is_inbox = true and new.column = 'in_progress' then
    insert into enrichment_queue (type, payload, workspace_id, status, next_attempt_at)
    values ('bot_notify', jsonb_build_object('alert_type', 'inbox_move', 'task_id', new.id), new.workspace_id, 'pending', now());
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_bot_notify_inbox_move
  after update on tasks
  for each row execute function notify_bot_on_inbox_move();
```

**2. pg_cron периодически вызывает Edge Function, которая опустошает очередь:**

```sql
select cron.schedule(
  'drain-bot-notify-queue',
  '5 seconds',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/drain-bot-notify',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))
  );
  $$
);
```

**3. Edge Function рассылает с учётом rate limit'ов Telegram и делает backoff при 429:**

```typescript
Deno.serve(async () => {
  const { data: jobs } = await supabase
    .from('enrichment_queue')
    .select('*')
    .eq('type', 'bot_notify')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(20);

  for (const job of jobs ?? []) {
    const chats = await getBoundChats(job.workspace_id);
    for (const chat of chats) {
      try {
        await sendWithRateLimit(chat.chat_id, job.payload); // не чаще 1 msg/сек на чат
        await markDone(job.id);
      } catch (err) {
        if (err.status === 429) {
          const retryAfter = err.parameters?.retry_after ?? 5;
          await requeue(job.id, retryAfter * 2);
        } else {
          await markFailed(job.id, err);
        }
      }
    }
  }
  return new Response('ok');
});
```

> **Альтернатива на будущее:** расширение `pgmq` (`pgmq.send()` в триггере, `pgmq.read()` с visibility timeout в cron-джобе) даёт retry-после-таймаута «из коробки» вместо самодельных полей `status`/`next_attempt_at`. Стоит рассмотреть при рефакторинге `enrichment_queue`.

### 6.5 Планировщик per-workspace: `/standup` по расписанию

Время стендапа задаётся индивидуально на воркспейс (`workspace_settings.standup_config.time_utc`). Ни Vercel Cron, ни Supabase Cron не умеют «расписание на тенанта» напрямую. Рабочий паттерн — tick + match:

```sql
select cron.schedule(
  'dispatch-standups',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-standups',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))
  );
  $$
);
```

```typescript
const nowUtcHHMM = new Date().toISOString().slice(11, 16);
const { data: due } = await supabase
  .from('workspace_settings')
  .select('workspace_id')
  .eq('standup_config->>enabled', 'true')
  .eq('standup_config->>time_utc', nowUtcHHMM);

for (const ws of due ?? []) {
  await supabase.from('enrichment_queue').insert({
    type: 'bot_notify',
    workspace_id: ws.workspace_id,
    payload: { alert_type: 'standup' },
  });
}
```

Данные и логика «кому пора» уже живут в Postgres — Supabase Cron избавляет от лишнего сетевого прыжка Vercel → Supabase каждую минуту. Важно: уникальность на `(workspace_id, date_trunc('day', now()), alert_type)` в `enrichment_queue`, иначе наложение соседних запусков cron продублирует стендап.

### 6.6 Лимиты платформы

| Компонент | Лимит (август 2026) | Что это значит для onitask |
|---|---|---|
| Vercel Function, Fluid compute, Pro | до 800с (GA), до 1800с (beta) | `/api/bot/webhook` не нужно дробить искусственно — STT + LLM + запись в БД укладываются в одном инвокейшне. Обязателен быстрый ACK через `waitUntil`/`after()` |
| Supabase Edge Function | wall-clock до 400с, request idle timeout 150с, CPU 2с/запрос | `/summary` должен уложиться в 150с или перейти на асинхронный паттерн |
| Telegram Bot API — глобальный лимит | ~30 сообщений/сек по всем чатам | drain-воркер (§6.4) должен рассылать пачками с паузами |
| Telegram Bot API — один чат | 1 сообщение/сек | обязательный троттлинг внутри `sendWithRateLimit` |
| Telegram Bot API — группа | ~20 сообщений/мин | учитывать при массовых standup-рассылках |
| Telegram — скачивание файла ботом | до 20 МБ | голосовые — почти всегда ок; длинное пересланное аудио — нет |
| Groq Whisper | — | таймаут 8с, см. STT Error Matrix §6.2 |

---

## 7. Риски и митигация

**Спам в чатах**
`notification_settings.on_inbox_move` и `on_overload` по умолчанию = false. Включает только Admin/Owner.

**Rate limits Bot API**
Очередь отправки через `enrichment_queue` (`type = 'bot_notify'`), драйвер — pg_cron (§6.4). ~30 msg/сек глобально, 1 msg/сек на чат, ~20 msg/мин на группу. Экспоненциальный backoff при 429 по значению `retry_after`.

**Privacy в групповых чатах**
Бот читает только явные вызовы (`@onitask`, `/команды`, reply на бота, caption-упоминание) — обеспечивается настройкой `/setprivacy` в BotFather (§5.1). Авто-прослушивание отключено навсегда.

**Workspace collision**
Приоритеты 1–5 резолвят автоматически (§3); при неоднозначности — асинхронная ветка с явным выбором пользователя (§6.2b), никогда не угадывается молча.

**Поддельные update'ы на вебхук**
`/api/bot/webhook` проверяет `X-Telegram-Bot-Api-Secret-Token` на каждый запрос (§6.1). Без секрета — 401.

**Повторная доставка update / двойной клик по кнопке**
Ожидаемое поведение, не край. Атомарность на уровне БД — единый механизм и для dedup задач (`dedup_key`, §6.2), и для claim черновика доски (`status='pending'`, §6.2b).

**Зависшие черновики резолюции доски**
TTL 10 минут (`bot_pending_drafts.expires_at`). Просроченный черновик не клеймится — пользователю предлагается повторить.

---

## 8. Roadmap

| Фаза | Срок | Функции |
|---|---|---|
| MVP Bot | 2–3 нед. | Единая точка входа `/api/bot/webhook` с диспетчеризацией по типу update; `/task` текст+голос (трёхфазный ответ, атомарный dedup по `dedup_key`); `@onitask` текст через корректный `chosen_inline_result`-флоу (`/setinlinefeedback 100`); асинхронная резолюция доски (`bot_pending_drafts` + `callback_query`); `/inbox`, `/flow`, `/task ALPHA-123`, `/resolve ALPHA-123`; онбординг через invite; secret_token на вебхуке; drain-воркер уведомлений |
| Phase 1.1 | +1–2 нед. | `/summary` (с асинхронным fallback при >100с), авто-уведомления при Inbox→Focus, `/stuck`, `/review`, `/standup` с блоком 📥 inbox, tick-cron для per-workspace расписания |
| Phase 2 | +2–3 нед. | `/who` + `/load`, алерты при bottleneck/overload, авто-standup по расписанию, `@onitask ALPHA-45 done` через `chosen_inline_result` |
| Phase 2.5 (фича-флаг) | по готовности | `BOT_RICH_MESSAGES_ENABLED`: Rich Messages для двухфазного ответа и standup-таблиц, с HTML-fallback |
| Phase 3 | Post-MVP | reply на сообщение → подзадача/комментарий; home-screen shortcut для TWA после онбординга |

---

## Changelog

### v0.6.5 — август 2026

*Кнопка карточки задачи ведёт в Mini App, а не в браузер*

- **§6.2d (баг, найден пользователем на ревью):** `taskUrl()` собирал обычную HTTPS-ссылку на `TWA_URL` — тап по кнопке открыл бы страницу во внешнем/встроенном браузере без `Telegram.WebApp` и без `initData`, на которые опирается вся авторизация. `web_app`-кнопка не решает проблему — по спецификации Bot API доступна только в приватных чатах с ботом, не в группах, где живёт основной флоу (§5.1). Исправлено на Direct Link Mini App — `https://t.me/<bot>/<app>?startapp=task_{full_id}` как обычный `url` кнопки, распознаётся Telegram и открывает Mini App в любом чате
- **Новая `miniAppDeepLink()`** — общий конструктор ссылок на Mini App, `taskUrl()` теперь через неё; отмечено, что тот же паттерн нужно применить и к другим deep link в документе («Открыть Flow Board» §5.3/§5.8, «Открыть задачу →» §5.7), которые пока описаны текстом без кода
- **Frontend-чтение `start_param`:** сознательно через `window.Telegram.WebApp.initDataUnsafe`, а не через `@telegram-apps/sdk`/`sdk-react` — у обёртки было ломающее изменение между v2 и v3 (убрали `useLaunchParams`), а `window.Telegram.WebApp` — стабильный официальный API
- **Аутентификация:** пример запроса задачи на фронтенде дополнен заголовком `Authorization` с `initData` — без него бэкенд не может проверить, кто спрашивает и есть ли доступ к доске (принцип из §5.8)

### v0.6.4 — август 2026

*Единая переиспользуемая карточка задачи*

- **§6.2d (новое):** `buildTaskCard(card, context)` — единый рендер для конца флоу создания задачи (§5.1) и просмотра по номеру (§5.6), три контекста (`created`/`duplicate`/`lookup`), `<blockquote>` для визуального выделения (Bot API 7.0, обкатанная возможность — не путать с Rich Messages за фича-флагом)
- **Новая RPC `get_task_card_data`:** общий источник данных карточки (джойн assignee/workspace name), чтобы не дублировать запрос в каждом хендлере
- **§6.1 (баг):** диспетчер отправлял `/task ALPHA-45` в создание новой задачи вместо показа существующей — не было ветки на паттерн `PREFIX-NUMBER` раньше общей `/task <текст>`. Добавлена и явно упорядочена
- **§6.2 (`createTask`):** при обнаружении дубля теперь дополнительно подтягивает существующую задачу и возвращает её карточку — пользователь видит полную карточку вместо голого «уже зафиксирована»
- **§5.6:** дописан реальный код `handleTaskLookup` (был только текстовый мокап) и инлайн-просмотр `@onitask ALPHA-45` с `cache_time: 30` (короткий кэш безопасен — в отличие от создания задачи, где обязателен `cache_time: 0`, просмотр не имеет побочных эффектов)
- **§6.2:** старые `buildConfirmation`/`buildReplyMarkup` удалены, заменены на `buildTaskCard`; `buildErrorMessage` остался отдельно — это про ошибку пайплайна, не про карточку задачи

### v0.6.3 — август 2026

*Оформление, тональность и жизненный цикл сообщений*

- **§6.2 (баг двойного экранирования):** `buildConfirmation()` уже экранировал пользовательские данные на месте вставки, `finalize()` затем экранировал весь составленный текст ещё раз — `&` в названии задачи превращался в `&amp;amp;`. Установлен и задокументирован единый контракт: экранирование один раз, в билдер-функции; `finalize()`/`editWherever()` доверяют входящему тексту
- **§6.2b (баг):** восстановление `MessageLocator` в `handleWorkspaceChoice` подставляло `inline_message_id` в поле `resultId` — dedup-ключ для задачи, созданной через асинхронный выбор доски, получался неверным. В `bot_pending_drafts` добавлена колонка `result_id`, locator собирается из двух полей корректно
- **Копирайтинг:** внутренний термин «TWA» убран из всей пользовательской копии (кнопки, сообщения об ошибках) — заменён на «приложение»/«Открыть в приложении». Термин остаётся в прозе документа и коде, где аудитория — разработчик, а не конечный пользователь
- **§6.2 (лимит длины):** добавлен `truncateForTelegram` — заголовок из сырого транскрипта (STT Error Matrix, уровень 2) мог быть неограниченной длины. Обрезка применяется к сырому полю до экранирования, не после — иначе риск разрезать тег/entity пополам и получить `400` от Bot API
- **§6.2b (новое — исчезающие сообщения):** просроченный `bot_pending_draft` раньше обрабатывался только реактивно (при клике). Добавлена периодическая задача `expire-pending-drafts` (pg_cron, раз в минуту), которая проактивно снимает мёртвую клавиатуру и заменяет её объяснением вместо того, чтобы оставлять нерабочую кнопку в чате
- **§5.1.3:** добавлен `cache_time: 0` в `answerInlineQuery` — по умолчанию Telegram кэширует ответ 300 секунд, наш результат собирается заново под каждый `query`
- **§6.2c (новое):** сводная таблица тональности — эмодзи-префикс → категория → тон → где используется, плюс явные правила формулировок (обращение на «ты», порядок «проблема → текущий результат → следующий шаг» в ошибках)

### v0.6.2 — август 2026

*Аудит на полноту реализации — закрыты пробелы между «описано» и «есть код»*

- **§5.1.4 (новое):** постановка задачи по reply на существующее сообщение — текст, голос, точечное выделение фрагмента (Quote & Reply, с оговоркой про историческую платформенную проблему доставки ботам в публичных группах)
- **§6.1a (новое):** чеклист настройки бота вне кода — Group Privacy Mode, `/setinlinefeedback 100`, `setMyCommands`, `setChatMenuButton` — раньше нигде не были собраны вместе, хотя без них флоу не работает независимо от качества кода
- **§5.1, §6.2:** добавлена поддержка forum topics (`message_thread_id`) — без неё ответы бота в группах с топиками уходят в «Общий»
- **§6.2 (закрытие пробела):** дописаны реализации `transcribe`, `parseTask`, `getCandidateWorkspaces`, `buildConfirmation`, `buildErrorMessage`, `buildReplyMarkup`, `editWherever`, `BotError`, `logBotError` — раньше код в §6.2/§6.2b на них ссылался, но реализации не было ни в файле, ни как заглушки
- **§6.2 (исправление):** `MessageLocator` для инлайн-случая — `resultId` (для dedup) и `inlineMessageId` (для `editMessageText`) разведены как два разных поля; раньше тип объявлял только `resultId`, хотя код финализации §5.1.3 уже требовал `inline_message_id` — несостыковка между типом и его использованием
- **§6.1:** рекомендован конкретный Bot API клиент (grammY) — раньше код использовал `bot.xxx()` без указания библиотеки
- **§6.1:** диспетчер `handleUpdate` дополнен веткой reply-флоу; явно оговорён порядок проверок (reply раньше обычной `/task <текст>`, иначе `/task`-реплай попадёт не в тот хендлер)

### v0.6.1 — август 2026

*Полное техническое флоу постановки задачи текстом и голосом*

- **§5.1 (реструктуризация):** три точки входа (`/task <текст>`, голос, `@onitask <текст>`) разведены в явные подсекции 5.1.1–5.1.3 вместо смешанного описания в бывших §5.1/§5.2
- **§5.1 (платформенная ошибка):** зафиксировано, что инлайн-режим Telegram технически не может нести файл (`inline_query.query` — только строка) — «голосовая задача через `@onitask`» из предыдущих версий описывала невозможный путь
- **§5.1 (уточнение):** добавлено объяснение Group Privacy Mode — без соответствующей настройки `/setprivacy` бот не увидит голосовое/текст в группе без явного упоминания, реплая или команды
- **§6.2 (исправление P0-01 продолжение):** dedup-ключ обобщён с `message_id`-only (баг: не уникален глобально, только в пределах чата) на составной `metadata.dedup_key`, единый для сообщений и инлайна
- **§6.2 (STT Error Matrix):** разделена на уровень 1 (ошибка распознавания, транскрипта ещё нет — fallback на заглушку с тегом `voice-unrecognized`) и уровень 2 (транскрипт есть, LLM parse не удался — fallback на сырой транскрипт как title). Ранее оба уровня схлопывались в один fallback на `raw_input`, которого на уровне 1 не существует
- **§6.2b (новое):** формализован асинхронный механизм резолюции доски для приоритета 6 (§3) — таблица `bot_pending_drafts` с поддержкой обеих схем адресации (chat / inline), атомарный claim черновика, обязательный `answerCallbackQuery`, TTL 10 минут
- **§6.1:** явно описана диспетчеризация update по типу внутри единого `/api/bot/webhook`
- **§5.6:** уточнена ссылка на §5.1.3 вместо устаревшей §5.2
- **§7:** добавлены риски «зависшие черновики резолюции доски» и обобщена формулировка защиты от повторной доставки/двойного клика
- **§8 Roadmap:** MVP-список обновлён под единую точку входа, `dedup_key` и асинхронную резолюцию доски

### v0.6.0 — август 2026

*Валидация и рефакторинг под Vercel + Supabase, актуализация под Telegram Bot API 10.1*

- §1, §6.4: заменено «Supabase Realtime-триггер → Edge Function» на Postgres-триггер → `enrichment_queue` → pg_cron-воркер → Bot API
- §6.2: dedup переведён с `SELECT`-затем-`INSERT` на unique index + обработку `23505`
- §5.2, §5.7: зафиксировано, что создание/изменение задачи через `@onitask` должно происходить на `chosen_inline_result`, требуется `/setinlinefeedback 100`
- §6.1: добавлена обязательная проверка `X-Telegram-Bot-Api-Secret-Token`
- §6.2: добавлен лимит скачивания файла Telegram (20 МБ)
- §5.1, §6.2: двухфазный ответ дополнен реакцией (`setMessageReaction`) и опциональным путём через Rich Messages за фича-флагом
- §5.9: разведены `start`/`startapp`, добавлена рекомендация про `addToHomeScreen()`
- §5.4, §6.6: сводная таблица лимитов Vercel Fluid compute и Supabase Edge Functions
- §6.5: tick-based паттерн планирования per-workspace `/standup` через Supabase Cron
- §7: конкретизированы численные rate limits Telegram
- §8 Roadmap: обновлён под трёхфазный ответ, атомарный dedup, secret_token, drain-воркер

### v0.5.0 — июнь 2026

*Security Layer (OWASP LLM Top 10 2025 — LLM-5 Improper Output Handling):*

- §5.6: реализация `escapeHtml()` в правилах форматирования standup-дайджеста
- §6.2: комментарий о применении `escapeHtml()` внутри `buildConfirmation(task)`
- §6.3: документация `sanitizeOutput(text, 'tg')`, whitelist тегов, запрет `<a href>`

### v0.4.0 — май 2026

- §2: добавлена команда `/resolve ALPHA-123`
- §3: реструктурирована таблица workspace resolution (6 приоритетов). Закрывает P1-01
- §4: `/resolve ALPHA-123` добавлен в Freemium-таблицу
- §5.1: переписан флоу голосовой задачи — двухфазный ответ, защита от дублей, InlineKeyboard для low-clarity. Закрывает P0-01, P1-03, P1-04
- §5.6: добавлен блок «📥 В inbox без подтверждения». Закрывает P1-05
- §5.8: сценарий `/resolve ALPHA-123`. Закрывает P1-09, P1-12
- §5.9: флоу онбординга через invite-ссылку. Закрывает P1-19
- §6.1: маршрут `POST /api/bot/task/:fullId/resolve`
- §6.2: двухфазный ответ, защита от дублей, STT Error Matrix. Закрывает P1-02
- §8: MVP-список обновлён

---

*onitask · Telegram Bot Functional Contract · v0.6.1 · август 2026*
