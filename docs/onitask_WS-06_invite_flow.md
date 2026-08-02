# WS-06 · Invite Flow — ТЗ на реализацию (после архитектурной ревизии)

**Статус:** готов к реализации (Cline / Dev Flow 7.3)
**Тег:** `#bot` `#ui` `#db` (затрагивает три слоя)
**Базируется на:** черновике `Инвайт_воркерс.txt` + ревизии в чате с Vadim
**Не заменяет:** `onitask_Architecture_Master_.md` — при реализации все DDL/RPC переносятся туда согласно правилам категорий документации.

> Этот файл — рабочий пакет задачи (task packet), а не канонический документ проекта.
> После реализации содержимое распределяется по целевым файлам согласно таблице в §7.

---

## 0. Итог ревизии — что изменилось относительно черновика

| # | Было в черновике | Стало (решение Vadim) | Обоснование |
|---|---|---|---|
| 1 | Ссылка `t.me/bot/Onitask?startapp=CODE`, приём через `/api/init` | **Подтверждено, канонический путь.** Заменяет `t.me/onitask_bot?start=ws_CODE` из `bot.md §5.9` | Официальная документация Telegram Mini Apps: `startapp` открывает Mini App напрямую, `start_param` передаётся в init data — без промежуточного бот-чата |
| 2 | Срок жизни ссылки — 24ч | **Подтверждено** | Решение Vadim; правится в Master §6.18 (было "7 days" в комментарии к `expires_at`) |
| 3 | «Никогда не деактивировать» ссылку при использовании | **Отменено.** Возврат к правилу Master: деактивация старой ссылки при создании новой ("один активный инвайт на workspace") | Проблема «ссылка на 5-6 человек» уже решена полем `max_uses` (default 10) — не нужно было ломать инвариант |
| 4 | Инкремент `used_count` без атомарности | **Добавлена атомарная RPC** `accept_invite_link()` | Гонка при параллельном переходе нескольких коллег по одной ссылке (ровно сценарий "6 человек из чата") |
| 5 | Создавать ссылку может любой участник (включая viewer) | **Только Admin/Owner** | Соответствует `workers.role` модели и намёку в `team_tab.md §2.6` ("Pending invites — Admin only") |
| 6 | SEC-06 чеклист: "BigInt через Number()" | Исправлено: **`BigInt(user.id)`**, `Number()` — источник бага | `product_vision.md §8.5` SEC-06 сформулирован обратно в черновике |
| 7 | — | `bot.md §5.9` (онбординг через бот `/start`) считается **устаревшим путём**, заменяется этим ТЗ | Один канонический механизм вместо двух параллельных |

---

## 1. Валидация механизма (источник: официальная документация Telegram)

- Прямая ссылка `https://t.me/botusername?startapp=CODE` (или `.../appname?startapp=CODE`) открывает Mini App **в текущем чате напрямую**, без сообщения от бота.
- Значение `startapp` попадает в `WebApp.initDataUnsafe.start_param` (и дублируется в `initData`-строке) и в GET-параметр `tgWebAppStartParam`.
- Допустимые символы `start_param`: `A-Z a-z 0-9 _ -`, рекомендуется base64url, лимит 512 символов.
- `code = randomBytes(16).toString('base64url')` (SEC-02, уже в проекте) — совместим без доработок.

**Предварительное условие:** у бота должен быть настроен Main Mini App (или Mini App с short name) через BotFather — иначе `startapp`-ссылка не откроет TWA. Уточнить фактическую настройку бота отдельно (не блокирует спеку, блокирует деплой).

---

## 2. Схема данных — БЕЗ изменений структуры

`invite_links` уже полностью описана в `Master §6.18`. Новых колонок не требуется:

```sql
-- Уже существует (Master §6.18), используется как есть:
CREATE TABLE public.invite_links (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code         text        UNIQUE NOT NULL,
  created_by   uuid        NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  max_uses     int         NOT NULL DEFAULT 10 CHECK (max_uses > 0),
  used_count   int         NOT NULL DEFAULT 0  CHECK (used_count >= 0),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

**Единственное изменение в Master** — комментарий/поведение поля `expires_at`:

```diff
- -- expires_at: Route Handler устанавливает now() + interval '7 days'
+ -- expires_at: Route Handler устанавливает now() + interval '24 hours'
```

### Новая RPC — атомарный accept (добавляется в Master §6.18)

Решает race condition при параллельном переходе нескольких людей по одной ссылке (аналог паттерна A-3 Atomic Quota: `INSERT ... ON CONFLICT`, здесь — `UPDATE ... WHERE ... RETURNING`):

```sql
CREATE OR REPLACE FUNCTION accept_invite_link(p_code text)
RETURNS TABLE(workspace_id uuid, invite_id uuid) AS $$
  UPDATE invite_links
  SET used_count = used_count + 1
  WHERE code = p_code
    AND is_active = true
    AND expires_at > now()
    AND used_count < max_uses
  RETURNING invite_links.workspace_id, invite_links.id;
$$ LANGUAGE sql;
```

Однострочный `UPDATE ... WHERE ... RETURNING` — атомарен на уровне строки в Postgres:
при гонке двух транзакций одна получит пустой result (условие `used_count < max_uses` не выполнится после первого коммита), 429/404 на уровне Route Handler.

Пустой результат (`0 rows`) = ссылка не найдена / не активна / истекла / исчерпан лимит — Route Handler не различает эти случаи на уровне SQL (различение — на уровне отдельного SELECT для сообщения пользователю, см. §5, Сценарий 4).

---

## 3. Роли

Создание ссылки — **только `workers.role IN ('owner', 'admin')`**. Проверка в Route Handler `POST /api/workspaces/[id]/invite`, не полагаться на RLS (по аналогии с MCP Middleware — Route Handler как единая точка проверки).

---

## 4. API-контракты

### 4.1 `POST /api/workspaces/[id]/invite`

Используется уже застолблённый в `dev_setup.md §2.2` путь (`workspaces/[id]/invite/route.ts`), не новый флэт `/api/invite` — консистентность с `members/route.ts`, `settings/route.ts`.

```typescript
// Запрос: без тела, workspace_id из URL
// Проверка роли: owner | admin (иначе 403)
// Rate limit: 10 запросов / 15 мин / IP (SEC-02)

// Логика:
// 1. UPDATE invite_links SET is_active = false
//    WHERE workspace_id = $id AND is_active = true
//    (деактивация предыдущей активной — "старый способ")
// 2. code = randomBytes(16).toString('base64url')
// 3. INSERT invite_links (workspace_id, code, created_by, expires_at, max_uses)
//    VALUES ($id, code, worker.id, now() + interval '24 hours', 10)
// 4. Ответ:
{
  success: true,
  data: {
    url: `https://t.me/onitask_bot/app?startapp=${code}` // либо ?startapp= на bot-username, уточнить short_name в BotFather
  }
}
```

### 4.2 `POST /api/init` — расширение (было: только find-or-create, INV-16)

```typescript
// Запрос
{
  init_data:   string,
  start_param?: string   // из WebApp.initDataUnsafe.start_param
}

// Логика (порядок важен):
// 1. Верификация Telegram initData (timingSafeEqual, A-2)
// 2. profiles: find-or-create (INV-16 — без автообновления display_name/avatar_url при повторных вызовах)
//    telegram_id: BigInt(user.id) — НЕ Number() (SEC-06)
// 3. ЕСЛИ start_param присутствует:
//    a. SELECT * FROM accept_invite_link(start_param)
//    b. ЕСЛИ строка вернулась:
//       - workers: find-or-create (workspace_id, source_id=profile.id, role='member')
//         (find, не create, если worker уже существует — идемпотентно)
//       - GET все workspaces профиля
//       - Ответ: { worker, workspaces, is_new_user: false }
//    c. ЕСЛИ пусто (invalid/expired/exhausted):
//       - Стандартная логика без start_param (см. п.4)
// 4. ИНАЧЕ (нет start_param, или accept_invite_link вернул пусто):
//    - Существующий профиль → его workspaces, is_new_user: false
//    - Новый профиль → пустые workspaces, is_new_user: true → Wizard
```

**Важно:** шаг 3b не проверяет отдельно «уже ли пользователь в этом workspace» — `workers` find-or-create с `UNIQUE(workspace_id, source_id)` идемпотентен сам по себе (ON CONFLICT DO NOTHING аналогично `auto_create_agent_worker`, Master §4).

---

## 5. Сценарии (ревизия черновика)

### Сценарий 1 — создание ссылки
Admin/Owner → `POST /api/workspaces/[id]/invite` → деактивация старой active → создание новой (`expires_at = +24h`, `max_uses = 10`) → возврат `startapp`-ссылки.

### Сценарий 2 — новый пользователь по ссылке
`startapp=CODE` → TWA открывается напрямую (без бот-чата) → `POST /api/init { start_param: CODE }` → profile создан → `accept_invite_link` возвращает `workspace_id` → worker создан с `role='member'` → Flow Board.

### Сценарий 3 — существующий пользователь, другой workspace
Аналогично, `workers` find-or-create добавляет второе членство, `workspaces` в ответе — оба.

### Сценарий 4 — ссылка истекла / лимит исчерпан
`accept_invite_link` возвращает `0 rows` → `/api/init` откатывается к стандартной логике (без start_param) → пользователь видит Wizard (если новый) или свои workspaces (если существующий). Отдельное сообщение об истёкшей ссылке — на усмотрение UI (не блокирует API-контракт).

### Сценарий 5 — 6 человек из чата по одной ссылке
Больше не проблема: `max_uses=10` покрывает это по умолчанию. Атомарный `accept_invite_link` исключает превышение лимита при параллельных переходах.

### Сценарий 6 (был "проблема") — снят с повестки
Исходная "проблема одноразовости" была следствием того, что черновик игнорировал уже существующие в Master поля `max_uses`/`used_count`. Правка не нужна — используем поля как спроектировано.

---

## 6. Открытые вопросы (не блокируют реализацию, но нужно закрыть до деплоя)

| # | Вопрос | Кто закрывает |
|---|---|---|
| 1 | Настроен ли у бота Main Mini App / short_name в BotFather для корректной работы `startapp`-ссылки | Vadim, вручную в BotFather |
| 2 | Судьба стаба `invite/[slug]/accept/route.ts` из `dev_setup.md §2.2` — приём инвайта теперь идёт через `/api/init`, отдельный accept-эндпоинт избыточен на MVP | Рекомендация: убрать из MVP route tree, вернуть в Phase 1.1 если появится сценарий "ручной ввод кода в уже открытой TWA" |
| 3 | Точная auth-схема вызова Supabase MCP для проверки факта миграций | Ожидает подключения коннектора (опт-ин запрошен) |

---

## 7. Файлы проекта — что и как менять (после подтверждения ТЗ)

| Файл | Раздел | Изменение | Версия |
|---|---|---|---|
| `onitask_Architecture_Master_.md` | §6.18 | `expires_at` 7d→24h (комментарий); новая RPC `accept_invite_link()` | 0.13.4 → **0.13.5** |
| `onitask_flow_.md` | новый §24 (после Workspace Manager) | UX `InviteModal.tsx`, сценарии 1–5 из §5 этого ТЗ. Закрывает разрыв: Invite FAB UX наконец переезжает из team_tab | 3.6.0 → **3.7.0** |
| `onitask_dev_setup.md` | §2.2 (route tree), §7 (новый §7.5) | Подтвердить `workspaces/[id]/invite/route.ts`; убрать/пометить Phase 1.1 `invite/[slug]/accept/route.ts`; новый контракт §7.5 `POST /api/workspaces/[id]/invite`; правка §7.1 `/api/init` — добавить `start_param` | 0.2.2 → **0.2.3** |
| `onitask_bot.md` | §5.9 | Переписать: `?start=ws_CODE` через бот-чат помечается как устаревший путь, канонический — `startapp` через TWA (ссылка на flow_.md §24 и dev_setup §7.5) | 0.6.0 → **0.7.0** |
| `onitask_product_vision.md` | AC-08-1 | Формат ссылки: `t.me/onitask_bot?start=ws_CODE` → `t.me/onitask_bot/app?startapp=CODE` (уточнить short_name) | 1.0.0 → **1.0.1** |
| `onitask_team_tab.md` | §2.6 | Пометка: UX-часть окончательно перенесена в `flow_.md §24` (сверх существующего Deprecated-статуса) | 1.3.0 → **1.3.1** |
| `onitask_INDEX_.md` | Файлы / Версии / Changelog | Синхронизация всех версий выше + запись в Changelog | 2.7.4 → **2.8.0** |

> Эти правки применяются только после твоего вердикта — по правилам роли Documentation Architect я не вношу изменения в реальные файлы проекта автоматически, только предлагаю. Если план принят — следующим шагом соберу точные `str_replace`-патчи по каждому файлу.

---

## 8. Definition of Done

- [ ] `POST /api/workspaces/[id]/invite` — только Admin/Owner, деактивирует старую активную ссылку, `expires_at=+24h`, `max_uses=10`
- [ ] `accept_invite_link()` RPC — атомарна, покрыта тестом на параллельный доступ (5–6 одновременных вызовов, один `code`)
- [ ] `POST /api/init` — обрабатывает `start_param`, идемпотентен по `workers (workspace_id, source_id)`
- [ ] `telegram_id` — везде `BigInt(user.id)`, не `Number()`
- [ ] Rate limit 10/IP/15мин на создание ссылки
- [ ] Ссылка формата `startapp`, не `start` (проверить реальную работу через BotFather-конфиг бота)
- [ ] Просроченная / исчерпанная ссылка → штатный fallback на Wizard/существующие workspaces, без ошибки 500
- [ ] Тесты: создание ссылки, accept новым/существующим пользователем, истечение, исчерпание `max_uses`, параллельный accept
- [ ] Обновлены `flow_.md §24`, `bot.md §5.9`, `dev_setup.md §2.2/§7.5`, `product_vision.md` AC-08-1, `Master §6.18`, `INDEX`
