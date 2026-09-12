# Active Context
# Active Context
## FILE-12: Комментарии → useInfiniteQuery (2026-09-12) ✅

**Сделано:** фид комментариев в шторке переведён с локального `useState` на
`useInfiniteQuery` (`['task-feed', taskId]`, staleTime 60с / gcTime 30м, keyset-курсор =
последний элемент загруженной страницы). Кэш — единственный источник истины:
optimistic-сабмит, broadcast-dedupe и «загрузить ещё» работают через `setQueryData`-хелперы
(`prependFeedItem` / `replaceFeedItem` / `removeFeedItem` / `mutateFeed`). Рендер —
`.flatMap().reverse()` (API-порядок «новые сверху» → хронология).

**Файлы:** `TaskCommentsPanel.tsx` (feed/submit/broadcast/render), `lib/api/comments.ts`
(+`getTaskFeedPage` — throwing-обёртка), `types/comments.ts` (+`CommentsPage`/`FeedPageCursor`).
Серверный роут, RPC и миграции не тронуты.

**Валидация:** tsc EXIT 0 ✅; `next build` — компиляция и проверка типов ✅, падение только
на pre-existing `/api/bot/webhook` page-data (нет локального env — не регрессия); lint —
pre-existing ESLint/rushstack фейл.

**Ручной QA (остаётся):** «загрузить ещё» до исчерпания; optimistic-отправка + замена
временной строки на серверную; broadcast во второй вкладке; отсутствие межзадачного
«кровосмешения»; переоткрытие шторки <60с из кэша; сетевая ошибка первой страницы.

retry_count: 0. Блокеров нет.


## FILE-10b: Hotfix WebAppDownloadFileParamInvalid (2026-09-11) ✅

**Симптом:** ошибка `WebAppDownloadFileParamInvalid` при клике «скачать» в TWA.

**Root cause (2 дефекта):**
1. **Сервер:** прокси-URL строился как `NEXT_PUBLIC_WEBAPP_URL || new URL(req.url).origin`.
   Telegram `downloadFile` ТРЕБУЕТ `https://` — без явного env (или на http://localhost)
   URL был http → Telegram бросал исключение. Правильный паттерн уже есть в
   `webhook/route.ts`: `NEXT_PUBLIC_WEBAPP_URL || `https://${VERCEL_URL}``.
2. **Клиент:** `WebApp.downloadFile` при невалидных параметрах БРОСАЕТ исключение,
   а не возвращает `false`. Каскад ловил только `ok === false` → исключение пролетало
   во внешний catch → показывалась ошибка вместо перехода на уровень 2 (fetch→blob).

**Fix:**
- POST `[attachmentId]/route.ts`: origin = `NEXT_PUBLIC_WEBAPP_URL || https://${VERCEL_URL}
  || origin запроса` + принудительный https (`replace(/^http:\/\//,'https://')`) — никогда
  не отдаём не-https.
- TaskViewEdit `handleDownloadAttachment`: `downloadFile` обёрнут в try/catch
  (throw → `ok=false` → уровень 2), т.е. каскад всегда продолжается.

Валидация: tsc EXIT 0 ✅. Коммит e082981.

---

## FILE-10: Скачивание без выхода из TWA — прокси + HMAC-токен + каскад (2026-09-11) ✅

**Симптомы из прода (после FILE-09):** (1) имя файла при скачивании — «тарабарщина.xlsx»
(Storage не формирует RFC 5987 для не-ASCII в Content-Disposition); (2) openLink уводил
на *.supabase.co и там предлагалось скачать; (3) на iOS WKWebView программные скачивания
ненадёжны в принципе.

**Решение — прокси на нашем домене + capability-токен:**
- `lib/shared/downloadToken.ts` (new): HMAC-SHA256(TELEGRAM_BOT_TOKEN, taskId:attId:exp),
  TTL 300с, timing-safe verify.
- POST `[attachmentId]`: вместо storage-подписи → токен + прокси-URL
  `${origin}/api/tasks/.../file?t=<token>` (+ `filename` в ответе).
- `GET [attachmentId]/file` (new): verify токен → `storage.download()` (service-role) →
  `Content-Disposition: attachment; filename="ascii"; filename*=UTF-8''<utf8>` +
  `Cache-Control: private, no-store`.
- `TaskViewEdit`: каскад — `WebApp.downloadFile(url, filename)` (нативно, Bot API 7.7+,
  без навигации; типизирован в useTelegramAuth) → `fetch→blob→anchor download` (в TWA) →
  `openLink` (наш роут отвечает attachment → мгновенное скачивание). supabase-домен
  исчез из пути человека полностью.
- Почему Telegram при чём: webview-страница не может писать в файловую систему
  устройства; на iOS «скачать» может только нативный хост → его запрос не может нести
  заголовки → нужен самоавторизующийся URL (токен).

**Валидация:** tsc EXIT 0 ✅; vitest: downloadToken 6/6 ✅ (подделка/scope/TTL/мусор),
общий ран = baseline (init.test 4 — pre-existing). Коммит e0e275d.

**Мануальный чек-лист (TWA):** Android — каскад (уровень 1 или 2, скачивание без
выхода из приложения); iOS — уровень 1; кириллическое имя; экспирация токена
(повторный клик через >5 мин — выдаётся свежий); офлайн-клик → ошибка в блоке.

retry_count: 0. Блокеров нет.

---
## FILE-09: Files UX — React Query + manifest-only + on-demand скачивание (2026-09-11) ✅

**Проблемы (3):**
1. Гонка при переключении задач — медленный ответ GET задачи A затирал список задачи B
   (локальный `useState` без guard'а), пользователь видел «чужие» файлы.
2. Каждое открытие шторки = GET с N+1 подписями Storage (до ~1.5с хвост).
3. Скачивание сломано: `<a target="_blank">` в TWA webview мёртв; signed URL с
   inline-диспозицией не скачивается.

**Решение (см. ADR-2026-09-11 в decisions.md):**
- **React Query v5 возвращён** (осознанно; zustand — нет). `src/app/providers.tsx`:
  QueryClient в useState, дефолты staleTime 60с / gcTime 30мин / retry 1 /
  refetchOnWindowFocus false. Обёрнут в layout как внешний провайдер.
- **TaskViewEdit**: `useQuery(['task-attachments', taskId])` (изоляция by design,
  без placeholderData); кэш = единственный источник истины — локальный список удалён;
  upload-каскад: append каждого файла через `setQueryData` + один invalidate после
  цикла; delete — фильтр через setQueryData; скачивание: `handleDownloadAttachment`
  → `signTaskAttachment` (спиннер на строке) → `Telegram.WebApp.openLink` /
  fallback `window.open`; иконка Download в строке (работает и в view-режиме).
- **flow.ts**: `getTaskAttachments` → throwing-контракт (манифест без url);
  **новый** `signTaskAttachment(taskId, attachmentId)`.
- **Сервер**: GET `/api/tasks/[id]/attachments` — чистый манифест БЕЗ подписей
  (N+1 устранён полностью); POST `[attachmentId]` — on-demand подпись
  `createSignedUrl(path, 3600, { download: filename })` + tenant-проверка по
  workspace задачи (паттерн DELETE); `lib/shared/attachments.ts` — хелпер принял
  `opts?: { download?: string }`. Агентский путь (`get_task_context`) не тронут.
- **Типы**: `TaskAttachmentData`/`TaskAttachment` — без `url`.

**Валидация:** `type-check` EXIT 0 ✅; `next build` — compile+types OK, падение
page-data `/api/bot/webhook` = pre-existing локальный env-гэп (vars в Vercel — по
решению владельца); vitest = baseline (workspaceContextCache 4/4 ✅, init.test
4 failed — pre-existing env-фейл); devtools в бандле нет (grep ✅).

**16 «Problems» в VS Code** — ESLint 9.39 × rushstack/eslint-patch несовместимость
(pre-existing, `Failed to patch ESLint`), не TS. Починка линтера — отдельный таск.

**Мануальный чек-лист после деплоя:** upload с прогрессом (пошаговое появление) ·
delete · быстрое A→B (нет чужих файлов) · повторное открытие <60с мгновенно ·
скачивание png/pdf + кириллическое имя (Content-Disposition) · офлайн-клик →
ошибка · view-режим скачивает · deep-link comments · **пост-деплой проверка
прод-чанка /flowboard** (урок missing_init_data).

**Follow-ups (TASKS.md):** FILE-10 комментарии → `useInfiniteQuery`; FILE-11
Realtime-инвалидация (Phase 2, security-review).

retry_count: 0. Блокеров нет.

---
## BUGFIX: 404 на attachments DELETE/POST — конфликт корней App Router (2026-09-10) ✅

**Симптом:** приложение падало 404 при работе с файлами задачи (upload/delete).

**Root cause:** DELETE-роут был создан в корневом `app/api/tasks/[id]/attachments/[attachmentId]/route.ts`
(6-level импорты `../../../../../../lib/...`), при том что весь App Router живёт в `src/app/`.
Когда рядом есть `app/` и `src/app/`, Next.js 15 не может резолвить два корня → роуты из `src/app/api`
падают 404.

**Fix (3 файла):**
- **Удалён** корневой `app/` целиком (содержал только сломанный роут).
- **Создан** `src/app/api/tasks/[id]/attachments/[attachmentId]/route.ts` — тот же DELETE
  (auth `extractInitData` + `isWorkspaceMember` по workspace задачи, storage best-effort,
  манифест с фильтром `.eq('task_id', taskId)`), но 7-level импорты `../../../../../../../lib/...`.
- **`src/lib/api/flow.ts`**: POST `uploadTaskAttachments` шёл без заголовка auth —
  `extractInitData` не читает multipart-тело (только `x-init-data` header / JSON body).
  Добавлен `headers: { 'x-init-data': initData }`. Поле `init_data` в FormData оставлено
  (не вредит).

**UI (TaskViewEdit.tsx)** — блок «📎 Файлы» в эталоне DocumentsCard уже реализован:
NotchedPanel-строки + кнопка X (спиннер при удалении), полоса `uploadCount/uploadTotal`,
CountBadge current/5, кнопка загрузки NotchedPanel field. `deleteTaskAttachment` в flow.ts
был добавлен коммитом 9107391.

**Валидация:** `npm run type-check` ✅ (EXIT 0). `npx vitest run`: workspaceContextCache 4/4 ✅;
init.test 4 failed — pre-existing env-фейл (см. запись CLEANUP ниже), к фиксу отношения не имеет.
`_diag.txt` / `tsc_out.txt` / `tsc_check.txt` удалены.

**Урок:** при создании роутов проверять корень (`src/app`, не `app`) — и что `extractInitData`
не покрывает multipart; для POST-загрузок заголовок обязателен.

retry_count: 0. Блокеров нет.

---
## FILE-01..08: Файлы задач + коммуникация агент↔человек (2026-09-10) ✅

## FILE-01..08: Файлы задач + коммуникация агент↔человек (2026-09-10) ✅

**Реализовано (TASKS.md Stage 14):**
- **Миграция 077** (применена на `atarmvtzvlwhkheeabeb`): `task_attachments` (манифест, связка
  `execution_id`→идемпотентность, UNIQUE(execution_id,filename)), `bot_task_messages`
  (reply-маппинг), `bot_attach_pending` (TTL 15 мин, purge-cron `bot-attach-ttl`),
  расширение `telegram_message_queue` (attachments/metadata). Bucket `task-attachments` создан.
  ⚠️ При применении: убран частичный TTL-индекс (`now()` не IMMUTABLE в предикате индекса → 42P17).
- **Исходящие агента**: `opsTerminalCore` + attachments → Storage + манифест в metadata;
  `bot-notify` `sendTaskAttachments` после карточки (review+done). `drainTelegramMessageQueue` —
  консьюмер исходящей очереди (чинит MCP-15, send_message_to_chat снова доставляет).
- **send_message_to_chat**: attachments + task_id → inline-кнопка «Обсудить задачу»
  (deep-link `task_<full_id>_comments` → TWA вкладка «Комментарии»).
- **Входящие TG**: `/attach` (reply / full_id), reply+файл, файл+caption→задача+attach,
  файл без caption→спросить; `src/lib/bot/attachments.ts`.
- **TWA**: TaskViewEdit — блок «📎 Файлы» (GET-подгрузка, upload), убран toggle «Зависимые задачи»;
  `GET/POST /api/tasks/[id]/attachments`.
- **Входные агенту**: `get_task_context` + `include_attachments` (signed URL TTL 1ч).
  Новый read-only MCP tool `get_task_comments` (обёртка над `get_task_feed`, duty poll, вариант A).
- **Каскад**: строки CASCADE; бинарники — явный `storage.remove()` в `DELETE /api/tasks/[id]`;
  GC-сирот — миг. 081 `gc_orphan_task_attachments()` (объект без манифеста, старше 1ч →
  Storage API bulk delete через `net.http_post` + Vault `service_role_key`; прямой DELETE из
  storage.objects блокирует `storage.protect_delete`) + defensive-очистка строк без задачи.
  Cron `gc-orphan-task-attachments` 03:10 UTC. Fire-and-forget с самоисцелением: упавший
  запрос → объект останется без манифеста → GC заберёт следующей ночью.
- **Reply-маппинг из bot-notify**: task_review + task_done карточки пишут `bot_task_messages`
  (локальный `rememberBotTaskMessage`, ON CONFLICT DO NOTHING) — reply+файл работает на
  любых карточках задач, не только на карточке создания.
- **Валидация**: `npm run type-check` ✅ (типы регенерированы/дополнены вручную: task_attachments,
  bot_task_messages, bot_attach_pending). ADR-2026-09-10. Smoke GC: `smoke_run = 0` ✅.

**Отложено (Phase 2):** Realtime `task-comments-<task_id>` для агентов (вариант B);
read-only allowed_tools для get_task_comments.

retry_count: 0. Блокеров нет.

---
## PERF: N+1 fix — batch enrichment в GET /api/tasks (2026-09-09) ✅

**Status:** Done (type-check ✅ — только pre-existing WIP-ошибки attachments).

**Файл:** `src/app/api/tasks/route.ts`
- GET: `for`-цикл `await enrichTaskRow(task)` (2×N запросов) → один вызов
  `enrichTaskRowsBatch()` (2 групповых запроса: getWorkspaceInfos + getWorkerNames `.in(...)`).
- Импорт: + `enrichTaskRowsBatch`, − `type EnrichedTask` (неиспользуемый);
  `enrichTaskRow` оставлен (используется в POST).
- Формат ответа `{ tasks, count }` и error-handling не изменились.
- Маппинг полей идентичен enrichTaskRow (проверено: те же fallback'и full_id/task_number/names).

**Эффект:** 50 задач = 100 запросов → 2 запроса.


## CLEANUP: Фаза 1 — удаление зомби-кода и неиспользуемых пакетов (2026-09-09) ✅

**Status:** Done. `npm run type-check` — 25 ошибок, ВСЕ в `src/app/api/tasks/[id]/attachments/route.ts`
(pre-existing WIP 077-attachments, не связано с очисткой). Регрессий от удаления нет.

**Удалены файлы (8):**
- `src/components/ui/Bottom` — легаси-дубликат BottomSheet.tsx (без импортов)
- `src/components/ui/Date` — легаси-дубликат DateRangeField.tsx (без импортов)
- `src/components/ui/DateRange` — легаси-дубликат DateRangeSheet.tsx (без импортов)
- `src/components/ui/badge.tsx` — Badge без импортов (используется desk-ui/CountBadge)
- `src/hooks/useKanban.ts`, `src/hooks/useTeamMetrics.ts`, `src/hooks/useAiQuota.ts` — пустые заглушки без импортов
- `src/lib/ai/quota.ts` — стабы «Not implemented» без импортов

**Сохранены (по решению владельца):** `src/lib/urgency.ts`, `src/lib/fractionalIndex.ts`.

**Удалены пакеты (npm uninstall, -38 пакетов):** @tanstack/react-query, zustand, vaul,
@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, framer-motion, wavesurfer.js, shadcn-ui.



## FEATURE: Передача владения доской + выход из доски (2026-09-08) ✅

**Status:** Implemented (type-check ✅ по нашим файлам — остаточные ошибки только
pre-existing WIP; lint сломан на уровне окружения: rushstack/eslint-patch × ESLint 9.39).
**Migration 080 НЕ применена к БД** — Supabase MCP/CLI неавторизованы; применить вручную
(Dashboard SQL editor / `supabase db push`): `supabase/migrations/080_transfer_ownership.sql`.

**Решения (согласованы с владельцем):**
- «Передать владение» — на СВОЕЙ карточке в WorkerSheet, у владельца показывается
  ВМЕСТО disabled-кнопки «Отозвать доступы». Пикер преемника (другие активные human)
  + confirm «Вы станете администратором».
- «Покинуть доску» — на СВОЕЙ карточке не-владельца (human). У владельца кнопка
  появляется только ПОСЛЕ передачи владения (UI-гейтинг; серверный guard остаётся).
- Текст confirm выхода (дословно от владельца): «Вы точно хотите покинуть доску "X"?» +
  мелким шрифтом «Вы потеряете доступ к доске "X" и не сможете взаимодействовать
  с задачами. Это действие необратимо.» Кнопки «Да, покинуть доску» / «Отмена».

**Changes:**
1. `supabase/migrations/080_transfer_ownership.sql` — dedup-страховка + unique index
   `uq_one_owner_per_workspace (workspace_id) WHERE role='owner'` (жёсткий инвариант
   «ровно один owner») + SECURITY DEFINER RPC `transfer_workspace_ownership`:
   FOR UPDATE лок строк, old owner → admin, target → owner, workspaces.owner_id
   синхронно (best-effort, source_id::uuid по regex).
2. `POST /api/workspaces/[id]/transfer-ownership` (новый) — только actor role='owner'
   (403); target: human + active + эта доска + не self (400); RPC; broadcast.
3. `POST /api/workspaces/[id]/leave` (новый) — soft-deactivate is_active=false;
   owner → 409 owner_must_transfer_first; broadcast.
4. `lib/api/flow.ts` — `transferWorkspaceOwnership()`, `leaveWorkspace()`.
5. `WorkerSheet.tsx` — AccessTab: isSelfOwner → «Передать владение» (disabled без
   кандидатов), isSelf non-owner human → «Покинуть доску»; пикер-модалка + leave-confirm
   (portal, паттерн revoke-модалки); optimistic role→admin после передачи.
6. `page.tsx` — `workspaceWorkers={workers}`, `onTransferSuccess` (refreshMetrics),
   `onLeaveSuccess` (boards-needs-refresh + router.push('/boards')).

**Валидация:** `npm run type-check` — только 9 pre-existing WIP-ошибок (наши файлы чистые);
lint — env-broken (не доходит до кода). Смок: transfer → «Покинуть доску» появляется,
leave member, leave owner → 409, чужие карточки без изменений.

## FEATURE: Вкладка «Доступы» в WorkerSheet — роль (текст) + пресет (селект) (2026-09-08) ✅

**Status:** Implemented (type-check ✅ по нашим файлам; остаточные ошибки — pre-existing
WIP 077-attachments / TelegramDeepLinkRouter; lint сломан на уровне окружения).

**Решения (согласованы с владельцем):**
- «Роль в доске» = кастомный текст (должность) → новая колонка `workers.role_title`
  (миграция 079, ≤ 50 симв, nullable).
- «Пресет доступов» = селект **Владелец доски / Администратор доски / Участник доски**
  → существующий `workers.role` (owner/admin/member). Лейблы всегда полные, чтобы
  читались как доступы, а не как должность. `viewer` в UI не показывается.
- Формат отображения в карточке/шапке: **«Пресет · Роль»** («Администратор доски ·
  Маркетолог»); без должности — просто пресет; агенты — «AI-агент».
- Права: пресет меняет owner/admin, кроме owner-цели и себя; должность — свою всегда,
  чужую owner/admin; должность owner'а — только он сам.

**Changes:**
1. `supabase/migrations/079_workers_role_title.sql` — `ALTER TABLE workers ADD COLUMN role_title`.
2. `types/supabase.ts` — role_title в Row/Insert/Update (ручная регенерация).
3. `src/lib/roles.ts` (новый) — PRESET_LABELS / EDITABLE_PRESETS / PRESET_DESCRIPTIONS /
   formatWorkerRole() — единый источник лейблов.
4. `PATCH /api/workers/[workerId]/access` (новый роут, по образцу revoke):
   валидации preset ∈ {admin, member}, role_title ≤ 50; permission-матрица выше;
   service-role update + broadcast `task_changed`.
5. `/api/flow/metrics` + `/api/workspaces/my-data` — `role`/`role_title` в workers-ответе.
6. `WorkerSheet.tsx` — таб «Доступы» рабочий: текстовый input роли, живой селект
   пресета (read-only у owner и не-admin), «Сохранить информацию» активна при dirty,
   PATCH + inline-ошибка; мёртвые ROLE_DISPLAY/SelectField удалены.
7. `page.tsx` — roleLabel из formatWorkerRole (хардкод «Участник команды» удалён),
   currentWorkerId + onSaveSuccess (optimistic update sheet + refreshMetrics).
8. `DataContext.tsx` — FlowMetrics.workers + role/role_title; worker-заглушка role_title: null.

**Валидация:** `npm run type-check` — по затронутым файлам чисто (8 ошибок pre-existing
вне скопа). `npm run lint` — сломан окружением (rushstack patch vs ESLint 9), pre-existing.

**Next:** `supabase db push` на dev/проект; ручной smoke: смена пресета admin↔member,
сохранение должности, 403-кейсы; потом commit `feat(flowboard): worker access tab`.

---
## FEATURE: Move Task sheet + Переместить/Редактировать в TaskViewEdit (2026-09-08) ✅

**Status:** Completed (type-check ✅; lint сломан на уровне окружения — pre-existing).

**Changes:**
1. `MoveTaskSheet.tsx` (новый): BottomSheet `stacked`, 4 колонки (MOVE_COLUMN_ORDER),
   круги с COLUMN_ACCENTS, amber confirm «Переместить в → <target>», disabled при
   target = current, хаптики. Экспортирован из `flowboard/index.ts`.
2. `TaskViewEdit.tsx`: проп `onMoveTask?: (taskId, newColumn) => void`; состояние
   moveSheetOpen/moveTargetColumn + sync useEffect + handleMoveConfirm (useCallback:
   onMoveTask → закрыть оба шита); блок действий: Переместить (amber Button) +
   Редактировать (NotchedPanel corner=action, fill var(--color-bg), зелёный
   градиент borderGradient grad-add-from/to); рендер `<MoveTaskSheet>` рядом с
   WorkerSelectSheet (вне BottomSheet).
3. `page.tsx`: `onMoveTask={handleMoveTask}` на `<TaskViewEdit>` (строка ~486).

**Валидация:** `npm run type-check` — чисто по нашим файлам; единственная ошибка —
pre-existing `lib/shared/attachments.ts(361)` (незавершённая фича 077, вне скопа).
Все правки применены точечными `.Replace`-эквивалентами с точными отступами —
дрейфа нет (git diff: только добавленные строки, 66+/4-).

**Next:** ручной smoke-тест в TWA (Переместить → выбор колонки → confirm →
оптимистичный перенос + rollback при ошибке). Commit: `feat(flowboard): move task sheet`.

---
## FIX: бесконечная загрузка для нового пользователя (2026-09-07) ✅

**Проблема:** новый пользователь (без профиля) открывал TWA по ссылке → вечный
GlobalLoader. Причина: у юзера без workspace `targetWorkspaceId = null || ''` →
`loadBoardsData()` никогда не вызывается → `SET_FIRST_LOAD_DONE` не диспатчится →
`AuthLoader` держит GlobalLoader (z-9999) вечно и маскирует экраны ошибок.

**Фикс (3 точки):**
1. `AuthLoader.tsx`: условие `!isLoading && (firstLoadDone || dataError || error)` +
   safety fallback 10s.
2. `DataContext.tsx` авто-эффект: ветка `else` (нет workspace) → `SET_FIRST_LOAD_DONE`.
3. `DataContext.tsx loadBoardsData`: `SET_FIRST_LOAD_DONE` в catch и в early-return
   (нет initData) — error-экраны с retry стали доступны.

**Валидация:** `npm run type-check` — только pre-existing ошибка
`lib/shared/attachments.ts(361)` (фича 077, вне скопа).
`tests/api/init.test.ts` падает pre-existing: тест мокает `@/lib/telegramAuth`,
а роут импортирует `src/lib/telegram/validate` → guard 500 (env). Вне скопа.

**Данные:** профиль друга (telegram_id=43105240, Egor_Popov,
`6eb9bbee-50f4-4d13-84fb-ee9242296168`) + worker `f061b4e1` (ws «Еж супер молодец»)
удалены на `atarmvtzvlwhkheeabeb` для retest. Остатков нет (profiles/workers/auth = 0).

**Коммит:** `fix(onboarding): infinite GlobalLoader for new users without workspace`
(только AuthLoader.tsx + DataContext.tsx; рабочая копия содержит незакоммиченную
фичу attachments/077 — не тронута).

---

## FIX INV-08: workspace_settings гарантия на уровне БД (2026-09-07) ✅

**Проблема:** миграция 042 дропнула `workspace_settings.mcp_api_keys`, но
`POST /api/workspaces` продолжал его вставлять → INSERT падал (PGRST204,
ошибка глоталась) → workspace без settings-строки → `/api/ai/create-task`
падал на `.single()` (PGRST116 → «Не удалось загрузить настройки»).

**Фикс (3 слоя):**
1. **Миграция 078** (`078_workspace_settings_backfill_and_trigger.sql`,
   применена на `atarmvtzvlwhkheeabeb`): функция `init_workspace_settings()`
   (SECURITY DEFINER, SET search_path, ON CONFLICT DO NOTHING) + триггер
   `trg_init_workspace_settings` AFTER INSERT ON workspaces + идемпотентный
   backfill через `WHERE NOT EXISTS`. Паттерн зеркалит trg_init_task_counter.
2. **`/api/workspaces`**: `.insert(...)` → `.upsert(..., { onConflict: 'workspace_id' })`,
   `mcp_api_keys` убран, добавлен `updated_at`. ON CONFLICT перекрывает дефолты
   триггера реальным конфигом формы, гонок нет (триггер — DO NOTHING).
3. **`/api/ai/create-task`**: `.single()` → `.maybeSingle()` + комментарий —
   отсутствие строки → NULL → дефолты parseF04Config, без 500.

**Валидация (все зелёные):**
- Миграция применена; сирот `workspaces w NOT EXISTS settings` = 0 (backfill сработал).
- Транзакционный тест: INSERT workspaces → settings-строка создалась триггером
  автоматически (`TRIGGER_TEST_PASSED settings_rows=1`), тест откатился, residue = 0.
- Дефолты синхронизированы: миграция (trigger fn + backfill) = upsert роута
  (velocity 14, own_tasks, standard, quota 60/40, standup 07:00, doc_kb 512KB/5MB/20, f04).
- `npm run type-check`: единственная ошибка — pre-existing
  `lib/shared/attachments.ts(361)` (незавершённая фича attachments/077, вне скопа).
- Lint сломан на уровне окружения (rushstack eslint-patch vs ESLint 9) — pre-existing.

**Побочно:** удалён фантомный файл `src/app/ai/create-task/route.ts` (артефакт
сбоя редактора, создавал ошибки TS1375/TS2304). `src/lib/mcpAuth.ts` (legacy,
0 импортов) — НЕ тронут, кандидат на удаление отдельным решением.

**Next:** коммит `fix(INV-08): DB-level workspace_settings guarantee + route resilience`;
e2e smoke создания workspace через UI после деплоя.

---

## BUGFIX: BottomSheet — активная зона сворачивания на вкладке «Комментарии» (2026-09-07) ✅

**Проблема:** На вкладке «Комментарии» (контент короткий, `scrollTop` всегда 0)
любой свайп вниз в любом месте шита (после 8px) захватывался и закрывал шит.
Активная зона закрытия была на всю высоту панели, в отличие от других боттом
шитов, где drag-to-close работает только из handle zone (верхние 48px).

**Фикс** (`src/components/ui/BottomSheet.tsx`, 3 строки):
- Новый ref `startedInHandleZone` — запоминает, начался ли тач в handle zone.
- В `onTouchMove`: захват жеста разрешён только если `startedInHandleZone === true`.
- Поведение на вкладке «Общее» (длинный контент, scrollTop > 0) не изменилось.

**Валидация:** `npm run type-check` ✅.

---

## AGENT-08: вкладка «Комментарии» — ЗАВЕРШЕНО (2026-09-06) ✅

**Реализовано (все этапы плана):**
- **Миграция 076** (`076_task_comments.sql`, применена на `atarmvtzvlwhkheeabeb`):
  durable-таблица `task_comments` (retention безлимитный, GC не трогает), RLS
  `task_comments_select_member` (single-per-table), security-fix — дроп
  `task_events_insert_comment` (дыра спуфинга автора из 002), RPC `get_task_feed`
  (task_comments + task_column_history + agent_events 7д, keyset-пагинация).
  Багфикс в ходе применения: алиасы колонок в первой ветке UNION (иначе
  `item_id does not exist`).
- **API**: `GET/POST /api/tasks/[id]/comments` (auth initData, tenancy-check,
  автор server-side через `getActiveWorkerInWorkspace` — R6), broadcast
  `comment_created` на `task-comments-<task_id>` (best-effort).
- **Клиент**: `src/lib/api/comments.ts`, типы `src/types/comments.ts`.
- **UI**: `TaskCommentsPanel` (342 строки: лента + optimistic submit + broadcast
  + composer TextArea/Button, ◆ для агентов, `formatFeedTime` в `src/lib/date.ts`),
  интеграция в `TaskViewEdit` (вкладка comments), экспорт из index.ts.
- **Доки/ADR**: `docs/memory-bank/decisions.md` ADR-2026-09-06 (R1–R8),
  flow_.md §22, Master §6.10-бис + §9 retention, TASKS.md AGENT-08 → [x].
- **Валидация**: `npm run type-check` ✅; advisors — новых нарушений нет;
  `types/supabase.ts` регенерирован.

**Отложено (Phase 2 / отдельные задачи):** edit/delete комментариев, replies
(`parent_id`), вложения задач (`ref_task_id`), MCP `add_task_comment`,
retention-настройка per-workspace.

retry_count: 0. Блокеров нет.

---


## Performance Advisor: INFO-линты закрыты, WARN — к решению (2026-09-05) ✅/⏳

**INFO `unindexed_foreign_keys` — исправлено (миграции 074 + 074-fix):** добавлены
покрывающие индексы для всех 14 FK-колонок без индекса: `tasks.created_by/
assigned_to/reviewer_id/active_claim_id`, `dispatch_outbox.task_id`,
`dispatch_receipts.outbox_id`, `mcp_agent_keys.created_by/workspace_id`,
`bot_review_fix_pending.workspace_id`, `enrichment_queue.workspace_id`,
`invite_links.workspace_id` (под именем `_full`, т.к. старое занято частичным),
`profiles.last_active_workspace_id` (`_full`), `task_column_history.moved_by`,
`telegram_message_queue.workspace_id`. Проверка pg_constraint/pg_index — пусто.
Примечание: частичные индексы (WHERE ...) НЕ используются RI-проверками FK.

**WARN остаются (решение за владельцем):**
- `auth_rls_initplan` — ~20 политик с inline `auth.uid()` (пересчёт per-row).
  Влияния на текущем объёме нет; фикс = переписать на `(select auth.uid())` —
  поведенчески безопасно, но трогает много политик.
- `multiple_permissive_policies` — `tracker.columns` (authenticated SELECT/
  UPDATE) и `bot_task_drafts` (owner + service). Owner-политики bot_task_drafts
  — легитимный owner-scope, мерж не требуется.
- ✅ **security-fix `bot_task_drafts` (миграция 075):** `bot_task_drafts_service_all`
  был `TO public USING(true)` (дыра: анонимы читали/писали все черновики) —
  пересоздан `TO service_role USING(true)`. Owner-политики не тронуты;
  `purge_expired_bot_task_drafts()` — SECURITY DEFINER, не затронут.
  Проверено: `public_wide_policies=0`.

## GC/Retention audit + миграция 073 (2026-09-05) ✅

**Аудит retention по live-БД** (`atarmvtzvlwhkheeabeb`): были защищены только
`agent_events` (7d, cron 2), `enrichment_queue(done)` (3d, cron 3),
`bot_task_drafts` (TTL, cron 13). **Найдены незакрытые накопительные таблицы.**

**Применено: миграция `073_log_gc_jobs.sql`** (6 функций GC, все пакетные,
`SECURITY DEFINER`-нет, `REVOKE EXECUTE FROM PUBLIC`; cron зарегистрирован вручную):
- `gc_task_events(p_batch=5000)` — `task_events` старше 30 дней (Master §9;
  LTM consolidate не задеплоен — hard-delete защищает от роста). Cron `gc-task-events` `30 3 * * *` (jobid 21).
- `gc_ops_history()` — `dispatch_outbox` published старше 7 дней +
  `task_executions` closed/expired старше 30 дней (receipts CASCADE). Cron `gc-ops-history` `0 4 * * *` (jobid 22).
- `gc_enrichment_queue_failed()` — `enrichment_queue` failed старше 7 дней
  (done чистит прежний cron). Cron `gc-enrichment-failed` `15 4 * * *` (jobid 23).
- `gc_bot_review_fix_pending()` — TTL-строки (`expires_at`), очистка ночная
  раз в сутки `30 1 * * *` (jobid 27; consumer лениво чистит истёкшие сам,
  поэтому ежечасно не нужно).
- `gc_telegram_message_queue()` — sent/failed старше 7 дней. Cron `45 4 * * *` (jobid 25).
- `gc_consolidation_errors()` — лог LTM, 30 дней. Cron `0 5 * * *` (jobid 26).

**Валидация:** все 6 функций выполнены в БД (вернули 0 — старых данных нет);
`cron.job` — 16 активных джобов; migration history содержит `073_log_gc_jobs`;
advisors без новых находок. Master §9 обновлён (таблица хранения + pg_cron).

**Замечено, не чинилось (вне scope):** `telegram_message_queue` — «мёртвый»
механизм, сохранено как отложенная задача (TASKS.md MCP-15, @deferred):
- **Writer единственный:** `lib/domain/agent/sendMessageToChat.ts` (MCP/REST
  инструмент `send_message_to_chat`, миграция 024). Кладет строку с
  `status='pending'`, `priority='normal'`, `source_agent`, `message` (после
  sanitize, ≤4000); проверяет привязку чата к воркспейсу; отдельный лёгкий
  лимит (не тратит AI-квоту).
- **Consumer отсутствует:** bot-notify читает только `enrichment_queue
  type='bot_notify'`; в репо нет ни SELECT, ни UPDATE, ни DELETE по этой
  таблице (кроме моего GC). В БД — только `gc_telegram_message_queue` +
  триггер `updated_at`.
- **Состояние на 2026-09-05:** 0 строк. Агент получает `{success:true,
  message_id:0}`, строка висит `pending` вечно (GC чистит только sent/failed).
- **Потенциальные пути применения (не решено):** расширить bot-notify
  читать очередь; перевести доставку на enrichment_queue type='bot_notify';
  сделать отложенный асинхронный канал для агентов.

## Arch 0.9 — WorkerPlan v1.1: Review Flow + Quick Launch (2026-09-04)

**`docs/WorkerPlan.md` v1.1** (уточнение v1.0 по фидбеку владельца — флоу review
и запуска были не проработаны). Новое:
- **§3.9 Review Flow** — полный цикл: ops_terminal(review, summary) →
  bot_notify(task_review) → Telegram-карточка с ra:approve/ra:fix →
  review_action RPC → done ИЛИ ra:fix → last_fix_reason + dispatch_outbox
  requeue → следующий ops_lease (миграции 062/064, доки 04/07, E2E E04/E11/E12).
- **§10 Quick Launch** — one-liner: `ONITASK_API_KEY + ONITASK_BASE_URL`
  достаточно (Realtime wake — базовый «будильник», БЕЗ JWT): `agent_key_id`
  резолвится сервером из api_key (resolveAgentKey + `id` в select),
  supabase_url/anon_key — через новый `GET /api/agent/realtime-config`
  (замена spec 15, JWT-обмен отклонён как переусложнение).
- CLI: `start | once | whoami | ping`; whoami-verify → exit 3 при auth-ошибке.
- **Server-зависимости RUNNER-02 (§10.6):** `id` в select resolveAgentKey
  (`lib/shared/mcpAuth.ts` ~118); новый route `/api/agent/realtime-config`.

## Arch 0.9 — WorkerPlan готов (RUNNER-02) (2026-09-04)

**`docs/WorkerPlan.md` v1.0** — полный план agent-worker (daemon) с секцией
верификации консистентности по коду. Ключевое:
- Транспорт: **только MCP** (`/api/mcp`, JSON-RPC 2.0 `tools/call`), auth = Bearer api_key, identity из ключа (INV 9).
- `ops_heartbeat` **продлевает lease** (062:182–186: `expires_at=now()+20min`) — `ops_renew_lease` не нужен; интервал = `heartbeat_interval_seconds` из lease-ответа (60с).
- `lease_expired` существует только у heartbeat; на terminal/ack — `404 execution_not_found`/`409 stale_claim`.
- `send_message_to_chat` **доступен агенту через MCP** (bot-токен серверно) — исходное решение playbook валидно; `bot_notify_queue` не существует (очередь = `enrichment_queue type='bot_notify'`, service-only).
- Квота в ops-контуре = `rate_limited` (429) / `quota_unavailable` (503 fail-closed), не `quota_exceeded`.
- Провал runner'а = `ops_nack` (outcome 'failure' не существует; terminal = review|escalate|handoff).
- SIGTERM → `ops_nack('runtime_busy')` (requeue), НЕ escalate (без спама Operator Queue).
- Recovery незавершённых задач = серверный reaper (cron 1 мин, ~21,5 мин worst case); воркер при старте ничего не восстанавливает.
- Из playbook перенесено в код воркера: duty-loop, seq, адаптивный poll, heartbeat-таймер, CTX-02 экономия контекста (1-й вызов полный, далее `include_*:false`), graceful shutdown, `<full_id>: <статус>`-отчётность.
- Структура: `worker/` (bin/cli.ts, mcpClient, wake/, orchestrator/, runner/), Node ≥24 type stripping, `@supabase/supabase-js` из root deps. Этапы W1–W5.

**Next:** реализация W1 (каркас: config + mcpClient + poll-only lease-цикл).

## Arch 0.9 — CL-01 Legacy cleanup ✅ (2026-09-03)

**Вычищены зомби-остатки long-poll/wake-webhook эпохи (миграция 072):**
- Дропнуты колонки `mcp_agent_keys`: `webhook_url`, `webhook_secret`, `key_plaintext` (дрейф — не было в миграциях), `agent_type`.
- `agent_events_tool_check` ужесточён: убраны `deploy_notify`/`fix_notify`.
- Удалены: пустая папка `supabase/functions/agent-duty-runtime/`, мёртвый экспорт `READ_ONLY_ALLOWED_TOOLS` (autonomyLevels.ts), `agent_type` из `types/supabase.ts`.
- LEGACY-баннеры: `docs/onitask_mcp_contract_.md` (шапка), `docs/ARCHITECTURE-COMPACT.md` §7.
- **Верификация:** колонок нет; CHECK без легаси-маркеров; ни одна функция/вьюха БД не ссылается на дропнутые колонки; advisors без новых находок; type-check ✅.

## Arch 0.9 Wake (stage 8) — server-side publisher REALTIME ✅ (2026-09-03)

### Финальное решение (Вариант A, подтверждено владельцем)
- **Broadcast = только best-effort wake; НЕ механизм доставки.**
- Действительную выдачу работы даёт `dispatch_outbox(pending)` + `ops_lease` + reconcile-таймер CLI.
- **postgres_changes отклонён**: это живой WAL-стрим без реплея для offline-клиентов + требует RNL/JWT-инфраструктуры (spec 15) + RLS-утечки outbox. Broadcast/poll дешевле и надёжнее.

### Что сделано
- **Миграция 071_outbox_wake.sql** (применена через MCP):
  - `dispatch_outbox.wake_sent_at timestamptz` — сторож однократной отправки (at-least-once guard). Статусы `pending`/`published` и `published_at` НЕ затрагиваются (`published` = «забран ops_lease»).
  - `public.ops_publisher_tick(p_batch int DEFAULT 100)` — drain pending → JOIN `mcp_agent_keys` → `realtime.send(payload, 'work.available', 'agent:'||key_id, false)` (public-канал), per-row `BEGIN/EXCEPTION`: успех → `wake_sent_at=now()`, сбой → `error` (строка остаётся pending — доставка через lease/riper).
  - cron `ops-publisher-tick` `'10 seconds'` → `SELECT public.ops_publisher_tick(100);`.
  - `payload`: `{event_id (outbox.id), type:'work.available', workspace_id, agent_key_id, ts}` — БЕЗ task_id/секретов.
- **`tools/wake-sniff.mjs`** — dev-only подписка на публичный канал `agent:<key_id>`.

### Валидация (на проде, project atarmvtzvlwhkheeabeb)
- `wake_sent_at` создана; `ops_publisher_tick` работает; `has_function_privilege(postgres, realtime.send) = true`; cron активен.
- **End-to-end подтверждён**: cron взял pending-строку → broadcast получен слушателем на канале `agent:156bc...` (payload корректен, без task_id).
- **Lease без Realtime работает**: тот же pending забран через `ops_lease` (task_version 17→18). → broadcast — чистое ускорение, надёжность не зависит от realtime.
- **Диагностика**: client→client и SQL→client broadcast работают; публикаций `supabase_realtime` для таблиц НЕТ (пустая), outbox RLS-on без политик (это намеренно).

### Следующие шаги
- **Этап CLI-рантайма** (spec 14): poll-only + realtime-listener на публичном канале (без JWT/RNL). Reconcile-таймер = гарантия.
- ~~**Legacy cleanup (CL-01)**~~ — ✅ выполнен 2026-09-03 (миграция 072, см. шапку).

---

## Architecture 0.9 — Stage 4 (MCP 0.9 tools) ЗАВЕРШЕН (2026-08-31)

**Status:** ✅ Код написан, type-check ✅. Lint сломан на уровне окружения
(rushstack eslint-patch vs новая ESLint — pre-existing, НЕ связано с изменениями).
Runtime-тестирование отложено (облако: Supabase + Vercel + Telegram WebApp —
локальный smoke невозможен; проверка после деплоя на Vercel, Stage 7 E2E).

### Сделано в Stage 4 (commit: stage 4)
- **`lib/shared/opsTools.ts` (новый)** — ядра 5 ops-инструментов
  (opsLeaseCore/opsHeartbeatCore/opsTerminalCore/opsAckCore/opsNackCore):
  валидация → quota (только lease, fail-closed) → ops_* RPC (062).
  Единая точка контракта для REST и MCP (parity B, contract 02).
- **`src/app/api/agent/ops/*`** — 5 REST-роутов переписаны на thin-обёртки
  над ядрами (handleOpsRequest + core, ~20 строк каждый).
- **`src/app/api/mcp/route.ts`**:
  - TOOLS: −`wait_for_tasks`, +`ops_lease/ops_heartbeat/ops_terminal/ops_ack/ops_nack`;
  - dispatch: ops-кейсы через `opsCtx()` — identity из ключа (`keyAgentName`),
    INV 9: mismatch header/ключ → 403 agent_not_allowed;
  - catch: `OpsApiError` → `{type: code, http_status: status}` (та же матрица
    ошибок, что у Ops REST);
  - убран `export const maxDuration = 60` (нужен был только 45s long-poll);
  - serverInfo 0.8.0 → 0.9.0.
- **Удалено**: `lib/domain/agent/waitForTasks.ts`, `WaitForTasksParams/Result`
  из `lib/shared/types.ts`, `'wait_for_tasks'` из `McpToolName`.
- **Коммиты**: `01fe201` (stage 1+3: docs/refactor-ai + миграции 060–068),
  `ced6e99` (stage 2: opsTransport + REST-роуты), stage 4 — следующим.

### Next (порядок)
1. **Stage 5**: playbook removal (R1) — `lib/shared/dutyPlaybook.ts` всё ещё
   описывает wait_for_tasks-цикл (строки/список tools) → переписать под
   ops_lease/terminal/ack/nack (doc 03 duty runtime 0.9).
2. Stage 6: bot-notify patch (reason из task_review payload).
3. Stage 7: E2E matrix (R7 requeue, human_override, max_attempts) — на Vercel.

---

## Architecture 0.9 — Stage 1 (migrations) + Stage 3 (Reaper) ЗАВЕРШЕНЫ (2026-08-31)

**Status:** ✅ Миграции 060–068 применены, smoke-тесты рипера пройдены. Next: Stage 2 (Ops REST API).

### Примененные миграции (в этой сессии)
- **064 `dispatch_producer_and_review_reason`** — G1: триггер `trg_dispatch_outbox_on_assign`
  (AFTER INSERT OR UPDATE OF assigned_to на tasks) кладёт pending в dispatch_outbox
  при назначении активному агенту (не при column='done'); R7: `review_action` rewrite —
  в ветке `fix` INSERT dispatch_outbox (assigned_to не меняется → триггер молчит),
  плюс `last_fix_reason` в metadata; G6: `notify_task_review` payload обогащён
  `reason ← tasks.metadata.ops_terminal_summary`.
- **065 `human_override_trigger`** — R8: BEFORE UPDATE OF "column" на tasks;
  если active_claim_id ≠ NULL и НЕ установлена маска `onitask.ops_mutation=1`
  (human-путь) → force-close execution (close_reason='human_override'),
  active_claim_id=NULL, moved_to_column_at=now(); version инкрементит триггер 046 (G5).
- **066 `drop_legacy_duty_state`** — R3 hard cut: DROP TABLE agent_duty_state,
  DROP FUNCTION resolve_agent_worker_id(text,uuid) (мёртвый, 0 вызовов).
  Безопасно: все ключи ревокнуты (061), waitForTasks.ts удаляется на Stage 5.
- **067 `ops_reaper`** — `ops_reaper_tick(p_batch)`: SKIP LOCKED выборка открытых
  execution с expires_at < now()-30s; close (vt_expired) → clear claim →
  attempt<3: requeue attempt+1 в outbox (ON CONFLICT pending DO NOTHING);
  attempt>=3: needs_human=true + escalation_reason='max_attempts'.
- **068 `tasks_escalation_reason_max_attempts`** — CHECK расширен значением
  'max_attempts' (базовый CHECK допускал только 4 escalate-причины — найдено smoke-тестом).

### Reaper cron (as-built, важно!)
- pg_cron в этом проекте **не поддерживает поле секунд**: '*/30 * * * * *' молча
  трактуется как «раз в 30 минут». Зарегистрировано `'* * * * *'` (ежеминутно).
- Роль миграций не имеет прав на cron.job (DELETE) — job регистрируется вручную:
  `SELECT cron.unschedule('ops-reaper-tick'); SELECT cron.schedule('ops-reaper-tick','* * * * *',$cron$SELECT public.ops_reaper_tick(100)$cron$);`
  Применено 2026-08-31 (jobid 19, запуск 06:03 UTC — succeeded).

### Smoke-тесты (пройдены)
- G1 продьюсер: INSERT задачи с assigned_to агенту → pending outbox (source='INSERT').
- Reaper A1 (attempt=1): execution closed vt_expired, claim очищен, дубликат outbox
  не создан (producer pending уже был → dedup работает).
- Reaper B3 (attempt=3): needs_human=true, escalation_reason='max_attempts'.
- Тестовые данные удалены (tasks LIKE 'REAPER-TEST-%' → 0).

### Next (порядок)
1. **Stage 2: Ops REST API** `/api/agent/ops/*` — 5 thin handlers (lease/heartbeat/terminal/ack/nack),
   auth через mcp_agent_keys (ключ → workspace_id + agent_name, INV 1key=1agent), quota через
   `check_and_decrement_quota`, audit через agent_events (063 tools).
2. Stage 4: MCP 0.9 tools (ops_lease/... вместо wait_for_tasks; удаление waitForTasks.ts).
3. Stage 5: playbook removal (R1) + удаление легаси lib/domain/agent/waitForTasks.ts читателей agent_duty_state.
4. Stage 6: bot-notify patch (reason из task_review payload).
5. Stage 7: E2E matrix (включая R7 requeue, human_override, max_attempts escalation).

---

# Active Context
# Active Context

## Hotfix: INV-04 worker onboarding не срабатывал для новых ключей (2026-08-27)

**Status:** ✅ Completed (код ✅, type-check ✅, прод-бэкфилл Drift ✅)

**Симптом:** ключ `Drift` прошёл auth/quota (`create_task` №26 в agent_events
08:42 26.08), но воркер на доске не материализовался. Причина: миграция 052
удалила триггер, но `resolveAgentWorkerId` остался подключён только к claim-ветке
`moveTask` — единый пайплайн `/api/mcp` его не вызывал вовсе.

**Fix (app-level, fail-open):**
- `src/app/api/mcp/route.ts` + `lib/shared/transport.ts`: ensure-worker после
  assertAgentRequest на КАЖДЫЙ tool call (по решению владельца: любой вызов,
  включая wait_for_tasks/get — агент виден на доске с начала дежурства).
- `lib/domain/agent/createTask.ts`: `tasks.created_by = авторский worker`
  (FK подтверждён: created_by → workers.id). Чинит bot_notify-получателей и
  строку «✍️ Постановщик» для агентских задач.
- Прод-бэкфилл: INSERT workers `agent::Drift`
  (id 8a104418-6d0c-4392-9d1a-615b5e7fa17b, ws ed93e8c5…). Аудит сирот:
  единственный легитимный кейс — Drift; telegram_user_* псевдо-агенты корректно
  вне воркеров (INV-04 работает как задумано).
- Исторический `created_by=NULL` задачи №26 НЕ бэкфиллился (вне scope фикса).

**Runtime-эффект заработает после деплоя на Vercel; БД-часть активна сразу.**

## Appendix (WF-A v2): as-built структура создания и контроля воркеров агентов

### Поток
Ключ sk_… → resolveAgentKey → assertAgentRequest (tenant+agent_name+allowed_tools)
→ ensure-worker fail-open [route.ts:361 | transport.ts:50] → dispatch tool →
quota RPC + rate-limit → logAgentEvent → agent_events (аудит).

### Создание (S)
- **S1** `resolveAgentWorkerId` (lib/shared/mcpAuth.ts:278) — ЕДИНСТВЕННАЯ точка
  создания type='agent': find-or-create upsert {workspace_id, type:'agent',
  display_name=agentName, source_id='agent::'+name}; concurrency-safe через
  UNIQUE (workspace_id, source_id) + re-select.
- **S1a вызовы S1** (после hotfix 27.08): /api/mcp tools/call · REST
  handleAgentRequest · moveTask(claim) · createTask(created_by).
- **S2 DB-триггер auto_create_agent_worker** — УДАЛЁН миграцией 052
  (фантомы telegram_user_* невозможны архитектурно).
- **S3 SQL RPC public.resolve_agent_worker_id (миграция 024)** — мёртвый объект:
  0 вызовов rpc() в живом коде (верифицировано поиском). Кандидат на DROP.
- Бот создаёт только human workers (source_id=profile.id) — вне агентского контура.

### Контроль (K) — все вызовы обоих транспортов
| Шаг | Механизм |
|---|---|
| K1 Аутентификация ключа | sha256 → mcp_agent_keys WHERE key_hash AND revoked_at IS NULL; workspace ИЗ ключа (A-7); last_used_at fire-and-forget |
| K2 Изоляция тенанта | явный workspace_id тела ≠ ключа → 403 |
| K3 Идентичность | agent_name обязателен БЕЗ дефолта; MCP: X-Agent-Name header приоритетнее body (route.ts:343) |
| K4 Авторизация тула | tool ∈ allowed_tools ('all'|список); observer → физически read-only |
| K5 Онбординг воркера | ensure-worker fail-open на КАЖДЫЙ вызов (решение владельца: агент виден на доске с первого любого вызова) |
| K6 Квота/лимит | check_and_decrement_quota (atomic RPC, A-3); rate 50/min = COUNT agent_events WHERE tool='create_task' |
| K7 Аудит | logAgentEvent → agent_events(tool, agent_name, summary, metadata); спец-маркеры deploy_notify/fix_notify |

### Читатели (R) — почему псевдо-имена безвредны
| Потребитель | Фильтр |
|---|---|
| UI карточки участников | строится из workers по FK задач, не из имён событий |
| wait_for_tasks dedup | .in('tool',['deploy_notify','fix_notify']) + своё имя |
| bot-notify причина движения | .eq('tool','move_task') |
| rate-limit | .eq('tool','create_task') |
| undo | по id + своему agent_name + workspace |
| get_task_context память | workers.source_id='agent::'+name → worker.id → agent_memory.worker_id |

Псевдо-имена telegram_user_<id> (tool='bot_command') — легитимный аудит
человеческих действий в Telegram-карточках; воркеров не создают (нет пути).

### Хвосты для плана консолидации
1. DROP мёртвого SQL RPC resolve_agent_worker_id (+ триггерные остатки 024 если есть).
2. Легаси-копия src/lib/mcpAuth.ts всё ещё документирует удалённый триггер — дезориентирует.
3. Семантика поля agent_events.agent_name (agentic name vs human-pseudoidentity
   для bot_command) нигде не зафиксирована формально — описать в mcp_contract.

## Previous Task: CTX-03 — playbook variants high/lite на ключе (2026-08-26)

## Current Task: CTX-03 — playbook variants high/lite на ключе (2026-08-26)

**Status**: ✅ Completed (миграция 059 применена, type-check ✅, БД-валидация ✅)

**Гипотеза (подтверждена):** full-плейбук слишком сложен для малых моделей
(Qwen3-A3B класс): прод-аномалии — пропуск claim (ONIT-18: backlog→review
напрямую, из-за чего пропало уведомление task_started), speedrun claim→review
за 5 сек — типичные отказы малых моделей на длинных процедурах.

**Решение:** `mcp_agent_keys.playbook_variant` ('high' | 'lite', default high,
CHECK; права не меняются). `DUTY_PLAYBOOK_FULL_LITE` — плоский чек-лист ~16
правил: цикл + ack + деплой с guard'ом dirty-tree; редкие ветки → escalate.
`resolveDutyPlaybook(level, stored, variant)`, override "<level>_lite".
POST/PATCH API + UI (4-я опция «Лёгкий полный» с пояснениями, combined value
'full_lite' сплитится в page.tsx). Валидация: type-check ✅, дефолт 'high' на
существующих ключах ✅, CHECK ✅.

## Previous Task: ONIT-25 — /call карточка по единому шаблону (2026-08-26)

**Status**: ✅ Completed (миграция 058 применена к прод, БД-валидация ✅)

**Проблема:** /call возвращал карточку без описания и без строки
«✍️ Постановщик» — RPC `get_task_card_data` не отдавал `description` и
`assignedByName`, поэтому lookup-карточка отличалась от единого шаблона
(bot-notify assignment template, §6.2d).

**Решение (миграция 058):** `get_task_card_data` дополнен ключами
`description` (tasks.description) и `assignedByName`
(workers.display_name по tasks.created_by). Рендер в lib/bot.ts
(renderTaskCardBody) уже поддерживает оба поля — изменений TS не требуется.
Локальный файл: supabase/migrations/058_get_task_card_data_full_template.sql.
Валидация: get_task_card_data_by_full_id('ONIT-24') → description +
assignedByName='kitamoru' ✅. Заработает на проде после деплоя вебхука
(RPC-часть активна сразу).

## Previous Task: CTX-01/CTX-02 — server-side duty state + гигиена payload (2026-08-25)


**Status**: ✅ Completed (миграция 056 применена, type-check ✅, БД-валидация ✅)

**Валидация (БД, через Supabase MCP):**
- upsert insert-путь ✅; конфликтный update-путь ✅ (seen_count растёт,
  updated_at свежий); CHECK `jsonb_typeof(seen)='array'` отклоняет мусор ✅;
  advisors: только ожидаемый INFO rls_enabled_no_policy (service-only,
  прецедент bot_review_fix_pending). Тестовые задача/стейт удалены.
- Runtime-путь (wait_for_tasks с новым кодом) заработает после следующего
  деплоя на Vercel; до деплоя прод работает по-старому (known_task_ids
  совместим — обратная совместимость сохранена).
- Этап 0: cline_mcp_settings.json onitask timeout 60→120 (+ supabase 60→120
  после кейса таймаута MCP при мультистейтменте).

**Проблема:** дежурный цикл раздувал контекст LLM-сессии — растущий
`known_task_ids` повторялся в каждом poll-вызове wait_for_tasks; Auto Compact
разрушал состояние (реконструкция через agent_active_tasks).

**Решение (CTX-01, миграция 056 `agent_duty_state`):**
- Таблица `agent_duty_state(workspace_id, agent_name PK, seen jsonb)`, RLS без
  политик = service-only. Ключ = аутентифицированная идентичность агента —
  id сессии НЕ передаётся клиентом; после компакта «голый» вызов находит тот же
  стейт. Клиентский payload константен `{timeout_sec, poll_seq}`.
- `waitForTasks.ts`: загрузка стейта разово на вызов; **двухфазная доставка
  (CTX-01a)**: `delivered` = мягкая пометка 10 мин (не-ack → повторная
  доставка — регрессия «назначил — не берёт» устранена), `acked` = жёсткая
  24ч (known_task_ids теперь ack-дельта обработанных); persist ДО возврата;
  cap 500; GC >7д; wall-clock guard (не стартовать итерацию при остатке <3с
  — фикс кейса MCP timeout 60s).
- Плейбуки observer/tasks/full: без known_task_ids; правило ретрая после
  ошибок (poll_seq+1, timeout_sec вдвое); после компакта просто продолжать цикл.
- Этап 0: cline_mcp_settings.json onitask timeout 60→120.
- **CTX-02:** get_task_context opt-out флаги include_workspace_context /
  include_memory_summary / events_limit (дефолты legacy); плейбуки: первый
  вызов за сессию без флагов, далее с флагами.
- Доки: mcp_contract §4.10 v0.9.0, §4.7, TASKS.md CTX-01/02.

**Валидация:** type-check ✅; live-тесты миграции 055 — pending (см. Act).

## Previous Task: DUTY-04 — loop-guard fix + INV-04 app-level onboarding (2026-08-25)

**Status**: ✅ Completed (миграция 052 применена, type-check ✅, live-валидация ✅)

**Проблема 1:** дежурный цикл Cline убит клиентским loop-guard'ом — duty-loop
шлёт идентичные payload'и wait_for_tasks подряд.
**Fix:** параметр poll_seq (prev+1, сервер игнорирует); schema/description +
плейбуки observer/tasks/full.

**Проблема 2:** фантомный воркер telegram_user_425693173 на доске «onit» —
INV-04 триггер материализовал псевдо-агента из webhook-аудита апрува
(первое выполнение кода c735e6c от 24.08).
**Fix (архитектурный):** триггер auto_create_agent_worker удалён; создание
воркера перенесено в resolveAgentWorkerId (find-or-create по
аутентифицированному ключу). Фантóмы невозможны архитектурно. Фантом удалён из БД вручную.

**Валидация:** type-check ✅; live: insert telegram_user_x event → воркер не
создаётся; upsert-резолв идемпотентен.

## Previous Task: DUTY-03 — причина возврата на доработку (2026-08-25)

**Status**: ✅ Completed (миграции 051 + hotfix применены, type-check ✅, БД-валидация ✅)

**Решение (двухшаговый UX + два канала доставки причины):**
- Миграция `051_review_fix_reason.sql`: `review_action(p_reason)` пишет
  `metadata.last_fix_reason` при fix; таблица `bot_review_fix_pending`
  (pending «ждём текст», TTL 1ч, UNIQUE(task_id), RLS без политик = service-only).
- Webhook: `ra:fix` → pending + карточка «напишите причину» с кнопкой
  **«⬆️ Назад»** (`ra:back` восстанавливает карточку ревью с кнопками выбора);
  текст в DM при активном pending потребляется как причина
  (`tryConsumeReviewFixReason`: auth A-08 дважды, свежий version, аудит с reason).
- `waitForTasks`: `fix_requests[].fix_reason` — мгновенный канал;
  `metadata.last_fix_reason` — персистентный (get_task_context после компакта).
- Плейбук full 6b: источник причины зафиксирован.

**Валидация:** type-check ✅; live-test в БД: test-task review→fix с причиной →
`last_fix_reason` записан, history-детект находит; pending insert/TTL/cleanup ✅;
тестовая задача удалена. Hotfix миграция `review_fix_reason_fn_fix`
(unqualified `metadata` вне контекста запроса PL/pgSQL).

## Previous Task: DUTY-02 — реактивные пинки деплоя/доработки через wait_for_tasks (2026-08-25)

**Status**: ✅ Completed (миграция применена, type-check ✅, БД-валидация ✅)

**Контекст:** кейс ONIT-7 — агент ушёл в review и завершил сессию; Telegram-апрув
перевёл задачу в done, но деплой не выполнился (деплой = агентская git-цепочка по
плейбуку full, секция 6а — периодический скан, который никто не выполнил).

**Решение (вариант B):**
- Миграция `050_deploy_wake.sql`: CHECK `agent_events.tool` += 'deploy_notify', 'fix_notify'.
- `waitForTasks.ts`: критерии пробуждения №2 (deploy_requests, review→done за 24ч,
  только autonomy_level='full') и №3 (fix_requests, review→in_progress, любой домен);
  детект по `task_column_history` (покрывает Telegram-апрув и TWA free-move);
  дедуп маркерами в agent_events (`metadata.history_id`), доставка ровно один раз.
- `dutyPlaybook.ts` (full): секция 6 реактивная — periodic-сканы убраны;
  deploy_requests → доменная фильтрация (не-разработка → ничего) / git-цепочка;
  fix_requests → безусловно взять в работу снова.
- Документация: mcp_contract §4.10, TASKS.md DUTY-02.

**Валидация:** type-check ✅; live-детект ONIT-7 в БД ✅; констрейнт отклоняет
мусорный tool ✅; маркер для ONIT-7 вставлен вручную (задача закрыта юзером до
роллаута фичи — повторный пинок не придёт).

## Previous Task: Database Cleanup — Delete all workspaces + clean related tables (2026-08-02)

**Status**: ✅ Completed

## Bugfix: Sprint "не найден" при activate/edit (2026-08-24)

**Status**: ✅ Fixed

**Symptom:** Sprint создаётся в БД и виден на FlowBoard, но «Активировать» / «Редактировать» → модалка «Спринт не найден».

**Root cause:** Хелпер `getAuthenticatedWorker()` в sprint API резолвил «рабочий воркспейс» через `.eq('source_id', profileId).eq('is_active', true).limit(1)` — возвращал **первый** активный воркер пользователя без привязки к воркспейсу спринта. У обоих пользователей (**kitamoru**, **truebulat**) по 2 активных воркера (Булатово `cf9684bf` + Онитаск `ed93e8c5`). `.limit(1)` без `ORDER BY` стабильно возвращал воркера из «Булатово» (создан раньше), а спринт создавался в «Онитаск» → tenancy-проверка `sprint.workspace_id !== worker.workspace_id` → 404 «Спринт не найден».

**Факты из БД (`atarmvtzvlwhkheeabeb`):**
- sprint `38ac068e…` (Онитаск-1, status=active) → workspace `ed93e8c5` (Онитаск)
- `.limit(1)` для kitamoru → worker `49c7059b` (Булатово); для truebulat → `3357e5e8` (Булатово) — оба НЕ в воркспейсе спринта → 404.

**Fix (Act-mode):**
1. `src/app/api/sprints/[id]/route.ts` — PATCH/DELETE: сначала найти спринт по id, затем `getAuthenticatedWorker(request, existing.workspace_id)` (резолв воркера в воркспейсе спринта); task-привязка по `existing.workspace_id`.
2. `src/app/api/sprints/[id]/activate/route.ts` — тот же паттерн с `sprint.workspace_id`.
3. `src/app/api/sprints/route.ts` — GET: опциональный `?workspace_id=` + фильтр по всем воркспейсам пользователя (без `.limit(1)`).

**Second bug (disturbed body) + architectural refactor (2026-08-24, Act):**
- **Root #2:** после реструктуризации, PATCH вызвал `request.json()` до `getAuthenticatedWorker(request, …)`. Внутри хелпера `req.clone().json()` на уже прочитанном теле бросает TypeError («disturbed request»); исключение глоталось try/catch → initData=undefined → 401-заглушка → «Спринт не найден». Молча.
- **Решение (единая архитектура):**
  - `lib/api-auth.ts`: добавлены `extractInitData(req)` (извлекает initData из клона ДО любого чтения тела), `isWorkspaceMember(profileId, workspaceId)` (resource-scoped tenancy по воркспейсу ресурса), `getUserWorkspaceIds(profileId)` (детерминированный список членств).
  - `sprints/route.ts` (GET+POST), `sprints/[id]/route.ts` (PATCH+DELETE), `sprints/[id]/activate/route.ts`: убраны все копии `getAuthenticatedWorker`, везде единый паттерн — `authenticateRequest(await extractInitData(req))` в начале (до тела) + tenancy по `workspace_id` самого спринта.
  - POST: fallback на первый воркспейс из `getUserWorkspaceIds` (а не случайный воркер/профиль).

**Validation:** `npm run type-check` ✅ (прим.: lint падает на инфраструктурной ошибке `@rushstack/eslint-patch` — не связано с изменениями). Эмуляция запроса в БД: оба пользователя теперь резолвятся в воркере «Онитаск» → tenancy OK.

**Tasks API: тот же рефактор (2026-08-24, Act):**
- **Проблема:** `src/app/api/tasks/route.ts` (GET/POST) и `src/app/api/tasks/[id]/route.ts` (PATCH/DELETE) использовали хелперы `getAuthenticatedProfile`/`getAuthenticatedWorker` с тем же недетерминированным `.limit(1)` — при мульти-воркспейс пользователе задачи создавались/искались в случайном board. Плюс:
  - PATCH **вообще не проверял tenancy** (update по голому `id`, `worker` — только для broadcast);
  - DELETE проверял хрупкий `profiles.last_active_workspace_id === task.workspace_id` → 403 валидному члену после переключения борда.
- **Fix (единые хелперы `lib/api-auth.ts`):**
  - добавлены `getActiveWorkerInWorkspace(profileId, workspaceId)` (воркер-строка внутри воркспейса для `created_by`) и `getDefaultWorkspaceId(profileId)` (last_active → первый из членств, детерминировано).
  - `tasks/route.ts`: GET+POST через `extractInitData` + `isWorkspaceMember` + дефолт-воркспейс; POST принимает `workspace_id` из тела с проверкой.
  - `tasks/[id]/route.ts`: PATCH/DELETE — auth через `extractInitData`, tenancy по `workspace_id` самой задачи (`isWorkspaceMember`); DELETE вместо `last_active`-сравнения; broadcast по `task.workspace_id`.
- **Validation:** `npm run type-check` ✅. `npm test`: `workspaceContextCache` 4/4 ✅; `init.test` 4/4 — это **пред-существующий** env-фейл теста (mock `@/lib/telegramAuth` не совпадает с реальным импортом; `TELEGRAM_BOT_TOKEN` не настроен), к изменениям отношения не имеет.

**Out-of-scope items закрыты (2026-08-24, Act, вторая волна):**
1. `tasks/[id]` DELETE: удалены мёртвые cleanup-вызовы к несуществующим таблицам `enrichments` и `task_vector_chunks` (остались только реальные: `task_relations`, `task_column_history`, `assignment_history`, `bot_task_drafts`).
2. `ai/create-task`: fallback `.limit(1)` заменён на `getDefaultWorkspaceId`; явный `workspace_id` теперь проверяется на членство через `getUserWorkspaceIds.includes` → 403 не-члену (раньше любой аутентифицированный мог вставить задачу в чужой воркспейс — дыра INV-05/A-07). Bot-путь (service-token + `profile_id`) работает так же.
3. `flow/metrics`: fallback «primary workspace» `.limit(1)` заменён на `getDefaultWorkspaceId(profileId)`. Проверка доступа к явному `requestedWorkspaceId` оставлена как была (она корректна — workspace-scoped).
- **Validation:** `npm run type-check` ✅ после всех правок.

---

**Summary:**
Inspected the Supabase database (project: Onitask, ref: `atarmvtzvlwhkheeabeb`) via Supabase MCP and performed a full cleanup of all workspace data.

**Before cleanup — row counts:**
| Table | Rows |
|---|---|
| workspaces | 8 |
| workers | 8 |
| workspace_settings | 6 |
| workspace_task_counters | 8 |
| tracker.columns | 32 |
| sprints | 4 |
| tasks | 0 |
| task_column_history | 0 |
| task_enrichments | 0 |
| agent_events | 0 |
| agent_memory | 0 |
| workspace_telegram_chats | 0 |
| task_events | 0 |
| consolidation_errors | 0 |
| workspace_documents | 0 |
| workspace_doc_chunks | 0 |
| assignment_history | 0 |
| task_relations | 0 |
| workspace_links | 1 |
| invite_links | 3 |
| calendar_connections | 0 |
| calendar_events | 0 |
| enrichment_queue | 1 |
| profiles | 2 |

**Actions taken:**
1. **Nulled `profiles.last_active_workspace_id`** — Both profiles (`truebulat`, `kitamoru`) had `last_active_workspace_id` pointing to workspaces. This FK has no `ON DELETE CASCADE`, so it was set to `NULL` first to avoid constraint violations.
2. **Deleted all 8 workspaces** via `DELETE FROM workspaces` — PostgreSQL `ON DELETE CASCADE` on all workspace-related FKs automatically cleaned up:
   - `workspace_task_counters`, `workers`, `workspace_settings`, `tracker.columns`, `sprints`, `tasks`, `invite_links`, `workspace_telegram_chats`, `task_events`, `agent_events`, `agent_memory`, `enrichment_queue`, `task_enrichments`, `assignment_history`, `task_relations`, `workspace_links`, `workspace_documents`, `workspace_doc_chunks`, `calendar_events`, `calendar_connections`
   - Plus task-level CASCADE: `task_column_history`, `task_enrichments` (via tasks)

**After cleanup — row counts:**
All workspace-related tables: **0 rows** ✅
`profiles`: **2 rows** (preserved — user identities tied to Supabase Auth, not workspace-specific) ✅

**INV/Architecture checks:**
- INV-01 through INV-16: No violations — all FK constraints with CASCADE properly cleaned up
- INV-10 (`workspace_telegram_chats.linked_by → profiles(id)`): No data to clean (0 rows)
- INV-16 (`/api/init` find-or-create): profiles preserved, `last_active_workspace_id` nulled
- A-07 (Tenant Isolation): All workspace-scoped data removed
- A-02 (Timing Safe): No secrets affected

**Next Steps:**
- Database is now in a clean state for fresh workspace creation
- No schema changes were made — only data cleanup

## Stage 5 — Playbook removal (ADR R1) — 2026-08-31

**Status**: ✅ Completed (type-check ✅)

**ешение:** ADR R1 (Accepted) выводит плейбуки из скоупа 0.9 полностью:
не резолвить playbook_variant/agent_duty_playbook в ops/MCP/runtime,
UI — feature off. DB-колонки (mcp_agent_keys.playbook_variant,
workspace_settings.agent_duty_playbook) остаются inert — не дропались.

**Changes:**
- `lib/shared/dutyPlaybook.ts` —  (255 строк: плейбуки observer/tasks/full,
  resolveDutyPlaybook, TOOLS_FOR_LEVEL).
- `lib/shared/autonomyLevels.ts` (новый) — оставшийся пермишен-маппинг:
  isAutonomyLevel, allowedToolsForLevel (observer → read-only toolset,
  tasks/full → 'all'). Observer-tiers теперь enforce'ятся серверно через
  allowed_tools (LLM-6 Excessive Agency).
- `mcpAuth.ts` — убраны PlaybookVariant import + keyContext.playbookVariant.
- `mcp-keys` POST/GET/PATCH — playbook_variant не читается/не пишется.
- UI (`settings/mcp`): убран вариант 'full_lite'/'блегчённый' из пикеров,
  combinedLevel = autonomy_level, Session Start Template больше не ссылается
  на duty_playbook (правила дежурства — в системе 03, агент гоняет ops-цикл).
- `getWorkspaceSettings` — agent_duty_playbook убран из SELECT и из
  WorkspaceSettingsPayload (types.ts).

**Next:** Stage 6 (bot-notify reason patch) → Stage 7 (E2E на Vercel).
перационка: перевыпуск ключей (061 ревокнула все), проверить cron-джобу рипера.

## Current Task: Stage 6 — bot-notify reason (G6) (2026-08-31)

**Status**: ✅ Completed (Edge Function — runtime-валидация на Stage 7 E2E)

**Scope:** `supabase/functions/bot-notify/index.ts` (единственный файл).
Эмиттеры не трогали: миграция 064 уже пишет reason в task_review payload
(← tasks.metadata.ops_terminal_summary) в той же TX.

**Changes:**
1. `fetchLastMoveReason` — read path по doc 07 §agent_events: prefer latest
   `tool IN ('ops_terminal','terminal_execution')` → metadata.summary ||
   metadata.reason (RPC 062 пишет {outcome, summary, execution_id, reason});
   fallback → legacy `move_task` → metadata.reason. Касается и task_done-карточки.
2. `processTaskReviewNotification` — reason сначала из `payload.reason`
   (пришёл из триггера 064, без доп. запроса), fallback fetchLastMoveReason.

**Next:** Stage 7 — E2E на Vercel (матрица doc 08: lease→terminal→ack,
R7 requeue, R8 human_override, G6 reason в уведомлении).
Операционка: перевыпуск ключей (061 ревокнула все), проверить cron-джобу рипера.

## Stage 7 — E2E verification (2026-08-31)

**Status**: ✅ Completed
**Commits pushed**: origin/main = 2a1b518 (stages 1–2, 4–6), GitHub синхронизирован с local.

**What was validated:**
- **DB-level RPC matrix** (service role, project `atarmvtzvlwhkheeabeb`, WS "Онитаск"):
  - Happy path: `ops_lease` → `ops_heartbeat` → `ops_terminal(review)` → `ops_ack` = ✅ (task→review, execution closed, task_version 1→3).
  - Strict ack: `ops_ack` без `terminal` → `{"error":{"code":"terminal_required",...}}` (→ HTTP 409 в API). ✅
  - R7: `ops_nack`×3 → requeue attempt+1; attempt>max → `needs_human=true`, `escalation_reason='max_attempts'`, outbox `published` (dead). ✅
  - R8: при открытом execution human `UPDATE tasks SET column='backlog'` → execution `closed` (trigger 065 force-close). ✅
  - G6: `tasks.metadata->>'ops_terminal_summary'` = terminal reason, read `fetchLastMoveReason` путь работает. ✅
  - Audit: `agent_events` пишет ops_terminal×1/ops_nack×3 (mutations); delivery-методы (lease/heartbeat/ack) не пишут — по контракту. ✅
- **HTTP-level on Vercel** (`https://onitask.vercel.app`):
  - New code deployed after `git push` (route was 404 pre-push). ✅
  - `POST /api/agent/ops/lease` w/ smoke key → `HTTP 200 {"job":null}` (auth + envelope verified; null=нет leasable work — outbox consumed by DB-level test). ✅
  - `/mcp` endpoint live (POST tools/list accepted). ✅
- **Operational tails:** `ops-reaper-tick` cron `* * * * *` активен ✅; `task_executions`+`dispatch_outbox` на месте ✅; migration 061 ревокнула все ключи, smoke-ключ `ops-smoke-agent` восстановлен вручную для тестов.

**Cleanup:** тестовая задача `STAGE2-SMOKE` + все производные строки (task_executions, dispatch_outbox, agent_events, task_events, ...) удалены каскадно. `test_tasks=0`, `test_events=0`, `dispatch_outbox` пуст.

**Pending owner actions:**
- Перевыпуск продакшн-ключей агентов (Drift/Cline ревокнуты миграцией 061).
- Lint окружение сломано (rushstack eslint-patch vs ESLint, pre-existing, не блокирует type-check).

