# onitask · Calendar Module — Функциональный контракт

**Версия:** 0.1.0 (новый)
**Дата:** июль 2026
**Статус:** Spec — готов к реализации

> **Схема БД** (`calendar_events`, `calendar_connections`) — см. [Master Spec](onitask_Architecture_Master_.md), раздел 6.19.
> **INV-17** — шифрование OAuth-токенов через pgcrypto AES-256-GCM.
> **Security**: `encrypted_oauth_tokens` — только внутри Edge Functions, никогда не передаётся клиенту.

---

## 1. Концепция

Модуль «Календарь» интегрирует внешние календари (Yandex, Outlook) в onitask для отображения событий в едином интерфейсе и отправки напоминаний через Telegram Bot.

**Архитектурный принцип:** собственная интеграция на open-source клиентах вместо платных посредников (Nylas, Cronofy, Merge.dev). Все вызовы к внешним API — Cold Path в Supabase Edge Functions (A-1).

### Почему своя интеграция?

| Провайдер | Цена | Комментарий |
|-----------|------|-------------|
| Nylas | от $0.90/аккаунт/мес | При росте базы — прямая переменная стоимость |
| Cronofy | от €749/мес | Порог входа выше MVP-бюджета |
| Merge.dev | Enterprise | Избыточно — 2 провайдера, не 20 |

Все три противоречат ТЗ «бесплатно для коммерческого использования». Строить тонкий адаптер дешевле по деньгам и не сложнее по инженерии.

---

## 2. Провайдеры и библиотеки

| Провайдер | Библиотека | Лицензия | Роль |
|-----------|-----------|----------|------|
| Yandex (CalDAV) | `tsdav` | MIT | CalDAV-транспорт (PROPFIND/REPORT/PUT/DELETE) |
| Yandex (парсинг) | `ical.js` | MIT | VEVENT ↔ структурные поля `calendar_events` |
| Outlook | `@microsoft/microsoft-graph-client` | MIT | `/me/events`, `/me/calendarView` |
| Outlook (auth) | `@azure/msal-node` | MIT | OAuth2 authorization code flow |

**Лицензионное ограничение:** разрешены MIT/Apache-2.0/BSD; запрещены GPL/AGPL для этого модуля.

---

## 3. Подключение календаря (OAuth Flow)

### 3.1 Yandex CalDAV

```
Шаг 1: Пользователь кликает «Подключить Yandex Календарь»
       → TWA отправляет запрос на Edge Function calendar_sync { provider: 'yandex' }

Шаг 2: Edge Function генерирует CalDAV OAuth URL
       → Перенаправление пользователя на Yandex OAuth

Шаг 3: Yandex возвращает authorization code
       → Edge Function обменивает code на access_token + refresh_token

Шаг 4: Токены шифруются (AES-256-GCM, INV-17) и сохраняются
       → INSERT INTO calendar_connections (encrypted_oauth_tokens, ...)

Шаг 5: Первый синхрон — fetch всех событий из календаря
       → Upsert в calendar_events с remote_event_id
```

### 3.2 Outlook Graph API

```
Шаг 1: Пользователь кликает «Подключить Outlook Календарь»
       → TWA → Edge Function calendar_sync { provider: 'outlook' }

Шаг 2: Edge Function генерирует MSAL auth URL
       → Перенаправление на Microsoft Login

Шаг 3: Microsoft возвращает code
       → msal-node обменивает code на tokens

Шаг 4: Токены шифруются и сохраняются в calendar_connections

Шаг 5: Первый синхрон — GET /me/calendarView?startDateTime=...&endDateTime=...
       → Upsert в calendar_events
```

### 3.3 Хранение токенов (INV-17)

```typescript
// В Edge Function calendar_sync:
import { encrypt, decrypt } from '@/lib/crypto';

const ENCRYPTION_KEY = Deno.env.get('ENCRYPTION_KEY'); // 32 байта

// Шифрование при сохранении:
const encrypted = encrypt(
  JSON.stringify({ access_token, refresh_token, expires_at }),
  ENCRYPTION_KEY
);

await supabase
  .from('calendar_connections')
  .insert({
    workspace_id, worker_id, provider,
    provider_account_email,
    encrypted_oauth_tokens: encrypted,
    token_expires_at: new Date(expires_at * 1000).toISOString()
  });

// Дешифрование при использовании (только внутри Edge Function):
const decrypted = decrypt(row.encrypted_oauth_tokens, ENCRYPTION_KEY);
const tokens = JSON.parse(decrypted);
```

---

## 4. Синхронизация событий

### 4.1 Edge Function `calendar_sync`

```typescript
// supabase/functions/calendar_sync/index.ts

import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import * as tsdav from 'tsdav';
import * as ical from 'ical.js';
import { createClient } from '@supabase/supabase-js';
import { authenticateWithMsal } from './msal-auth.ts';

serve(async (req) => {
  const { workspace_id, provider, action } = await req.json();

  // 1. Авторизация service-to-service (A-2: timingSafeEqual)
  const serviceKey = req.headers.get('Authorization');
  if (!timingSafeEqual(serviceKey, SUPABASE_SERVICE_KEY)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Получаем connection и дешифруем токены
  const { data: conn } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('workspace_id', workspace_id)
    .eq('provider', provider)
    .eq('is_active', true)
    .single();

  const tokens = decrypt(conn.encrypted_oauth_tokens, ENCRYPTION_KEY);

  // 3. Провайдер-специфичная логика
  if (provider === 'yandex') {
    return await syncYandex(workspace_id, conn, tokens);
  } else if (provider === 'outlook') {
    return await syncOutlook(workspace_id, conn, tokens);
  }

  return new Response('Unknown provider', { status: 400 });
});
```

### 4.2 Yandex CalDAV Sync

```typescript
async function syncYandex(workspaceId, conn, tokens) {
  // CalDAV PROPFIND для получения списка календарей
  const calendars = await tsdav.propFindCalendarHomeSet(
    { url: 'https://caldav.yandex.ru/calendars/' },
    { Authorization: `Bearer ${tokens.access_token}` }
  );

  // REPORT для получения VEVENT за период
  const events = await tsdav.reportCalendar(
    {
      url: calendars[0].url,
      xmlBody: `
        <C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav">
          <D:prop xmlns:D="DAV:">
            <C:calendar-data/>
          </D:prop>
          <C:filter>
            <C:time-range start="${since}" end="${until}"/>
          </C:filter>
        </C:calendar-query>
      `
    },
    { Authorization: `Bearer ${tokens.access_token}` }
  );

  // Парсинг iCal через ical.js
  const jcal = ical.parse(events);

  for (const component of jcal) {
    if (component.name === 'VEVENT') {
      await upsertCalendarEvent(workspaceId, component, 'yandex');
    }
  }

  return new Response(JSON.stringify({ synced: true }));
}
```

### 4.3 Outlook Graph API Sync

```typescript
async function syncOutlook(workspaceId, conn, tokens) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString();

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );

  const data = await response.json();

  for (const event of data.value) {
    await upsertCalendarEvent(workspaceId, event, 'outlook');
  }

  return new Response(JSON.stringify({ synced: true }));
}
```

### 4.4 Upsert события

```typescript
async function upsertCalendarEvent(workspaceId, rawEvent, provider) {
  const remoteId = provider === 'yandex'
    ? rawEvent.JCAL().getComponent('UID').toJSValue()
    : rawEvent.id;

  await supabase
    .from('calendar_events')
    .upsert({
      workspace_id: workspaceId,
      provider,
      remote_event_id: remoteId,
      title: rawEvent.summary || rawEvent.subject || 'Без названия',
      description: rawEvent.description || null,
      start_at: new Date(rawEvent.start.dateTime || rawEvent.dtStart.toJSDate()).toISOString(),
      end_at: new Date(rawEvent.end.dateTime || rawEvent.dtEnd.toJSDate()).toISOString(),
      source_synced_at: new Date().toISOString(),
      reminder_minutes_before: 15 // дефолт
    }, {
      onConflict: 'workspace_id,provider,remote_event_id'
    });
}
```

---

## 5. Напоминания

### 5.1 Триггеры (автоматическое планирование)

При INSERT/UPDATE события триггер `trg_schedule_calendar_reminder`:
1. Удаляет устаревшее pending reminder (если время изменилось)
2. Создаёт новую запись в `enrichment_queue` с `type='bot_notify'`, `alert_type='calendar_reminder'`
3. `scheduled_at = start_at - reminder_minutes_before`

При DELETE события триггер `trg_cancel_calendar_reminder`:
1. Удаляет все pending reminders для этого event_id

### 5.2 Воркер напоминаний

Edge Function `calendar_reminder` обрабатывает pending job:
1. Читает `enrichment_queue` запись
2. Перечитывает `calendar_events` (чтобы текст был актуальным)
3. Резолвит `target_worker_id → workers.source_id → profiles.telegram_id`
4. Отправляет `sendMessage` в личный чат

**Edge case:** пользователь не писал боту → 403 DM невозможен → статус `failed`, без ретраев.

### 5.3 Формат сообщения

```
📅 Напоминание: «${event.title}»
⏰ Начало: ${formatTime(event.start_at)}
📍 Длительность: ${duration(event.start_at, event.end_at)}

[Открыть в TWA →]
```

---

## 6. UX подключения

### 6.1 Страница настроек календаря

```
┌─────────────────────────────────────┐
│  📅 Календарь                       │
├─────────────────────────────────────┤
│                                     │
│  🔗 Подключённые аккаунты           │
│                                     │
│  🟢 Yandex Календарь                │
│     user@example.com                │
│     [Отключить]                     │
│                                     │
│  ⚪ Outlook Календарь               │
│     [Подключить]                    │
│                                     │
│  ⏰ Напоминания по умолчанию        │
│     За [ 15 ] минут до события      │
│     [Сохранить]                     │
│                                     │
└─────────────────────────────────────┘
```

### 6.2 Виджет календаря в TWA

```
┌─────────────────────────────────────┐
│  ◀ Июль 2026 ▶                      │
├──────┬──────┬──────┬──────┬────────┤
│ Пн   │ Вт   │ Ср   │ Чт   │ Пт     │
├──────┼──────┼──────┼──────┼────────┤
│      │      │  1   │  2   │   3    │
│      │      │ ●●   │      │   ○    │
│      │      │ Код  │      │ Митинг│
├──────┼──────┼──────┼──────┼────────┤
│  4   │  5   │  6   │  7   │   8    │
│ ○    │      │      │ ●●   │   ○○   │
│ Ревью│      │      │ Спринт│Дедлайн│
└──────┴──────┴──────┴──────┴────────┘

● = 1 событие    ○ = 1+ событий
```

---

## 7. Риски и митигация

| Риск | Митигация |
|------|-----------|
| Утечка OAuth-токенов | Шифрование AES-256-GCM (INV-17), токены никогда не покидают Edge Functions |
| Гонка при отправке напоминания | Воркер перечитывает событие перед отправкой |
| 403 при DM пользователю без /start | Обработка как failed, без ретраев |
| Rate limits Yandex/Outlook | Backoff + очередь через enrichment_queue |
| Copyleft лицензии библиотек | Whitelist: MIT/Apache-2.0/BSD; запрет GPL/AGPL |

---

## 8. Roadmap

| Фаза | Срок | Функции |
|------|------|---------|
| MVP | 2–3 нед. | Подключение Yandex/Outlook, базовый синк, напоминания через бота, UI календаря |
| Phase 1.1 | +1–2 нед. | Recurring events (RRULE), множественные напоминания, drag-and-drop перенос |
| Phase 2 | +2–3 нед. | Shared calendars (между участниками workspace), color-coded провайдеры |

---

## Changelog

**v0.1.0 — июль 2026**
- Инициальная спецификация модуля «Календарь»
- Провайдеры: Yandex CalDAV, Outlook Graph API
- Архитектура: собственные open-source клиенты вместо Nylas/Cronofy
- Напоминания через enrichment_queue + Bot Notify Worker
- INV-17: шифрование OAuth-токенов

---

*onitask · Calendar Module · v0.1.0 · июль 2026*