# MOC · onitask

**Точка входа в документацию проекта.** Для операционного маппинга "что делаю → что читаю" — см. [onitask_INDEX_.md](onitask_INDEX_.md). Этот MOC — навигационная карта Vault: слои, статусы, версии, куда что переехало.

**Правило чтения:** Master — всегда. Feature-документ — по задаче. Операционное приложение — по конкретной реализации.

---

## 🎯 Продукт и стратегия

- [[onitask_product_vision]] · v1.0.0 · ✅ Утверждён
  Production Vision, JTBD, ODI-метрики, Four Forces, User Stories, AI Security Principles, бренд.
  *Не содержит DDL — только продуктовый слой.*

---

## 🏛 Архитектура (источник истины)

- [[onitask_Architecture_Master_]] · v0.13.3 · ✅ Утверждённый источник истины
  Инварианты (INV-01…INV-16), аксиомы (A-1…A-12), полная схема БД, task_relations, конкурентность, retention.
  Заменяет: Arch V4.3, Flow Concept V3.2 (Schema), Team Tab V1.0 (Schema), Bot V0.1 (Schema).
  > Перед любой миграцией, Route Handler или Edge Function — читать разделы «Инварианты» и «Полная схема БД» первыми.

### Миграции (канонический SQL)

- `supabase/migrations/001_init.sql` · v1.0.0 — полная DDL-схема, основана на Master Spec
- `supabase/migrations/002_rls.sql` · v1.0.0 — RLS-политики, helper-функции, 21 таблица

---

## ⚙️ Функциональные контракты (Feature Specs)

- [[onitask_ai_]] · v0.10.1 · ✅ Production-Ready
  F-01 Cognitive Budget · F-03 Enrichment (RAG + implicit calibration + embedding cache) · F-04 Instant Parse · F-06 MCP Router · Workspace Context Rebuild Pipeline · LTM Pipeline + Injection Linter.
  ↳ Схема: Master §6.4–6.8, 6.10, 6.16 · Аксиомы: Master §3 (A-1…A-12)

- [[onitask_flow_]] · v3.6.0 · 🟡 Концепт → готов к F-07
  Flow Board UX, колонки, роли, Stream, аномалии, AI Flow Summary, Risk Pulse, Worker Sheet, Operator Queue, Task Sheet (Блокировки), Workspace Manager.
  ↳ Схема: Master §4, 6.2, 6.3, 6.16 · Настройки: Master §8 · Аксиома A-12
  *Поглотил Team Tab UX (§19–23) после deprecation.*

- [[onitask_bot]] · v0.5.0 · 🟡 Pre-Spec — готов к реализации
  Bot-команды, workspace resolution, freemium, сценарии, Realtime-уведомления, output sanitization.
  ↳ Схема: Master §6.9 · Security: Master §6.4, [[onitask_security_]]

### ⚠️ Deprecated (справочник)

- [[onitask_team_tab]] · v1.3.0 · ⚠️ Deprecated
  UX-содержимое перенесено в [[onitask_flow_]] §19–22. Сохранён как справочник для SQL-запросов (velocity/агенты), `escalate_task` MCP tool, Operator Queue SQL — **до завершения полной миграции не удалять**.

---

## 🔌 Операционные приложения

*Прикладной слой поверх Master + Feature — читать по конкретной задаче реализации.*

- [[onitask_mcp_contract_]] · v0.7.1 · ✅ Production-Ready
  MCP tools: сигнатуры, blocked_by, subgraph, smart backlog, cascade unblock, allowed_tools scopes, rate limit, DFS cycle check, ошибки, рекомендации агентам.
  ↳ Главные ссылки: [[onitask_Architecture_Master_]] · [[onitask_ai_]] · Схема task_relations: Master §6.16 (A-12)

- [[onitask_sql_anomalies_]] · v1.6 · ✅ Production-Ready
  SQL-вьюхи (orphan_blockers, handoff_chain), триггеры (cascade_unblock, handoff_chain_alert), воркер аномалий.
  ↳ Core DDL — только в [[onitask_Architecture_Master_]] §6 · Интерпретация UI: [[onitask_flow_]] · Справочник метрик: [[onitask_team_tab]] · Доставка алертов: [[onitask_bot]]

- [[onitask_security_]] · v0.1.0 · ✅ Production-Ready
  OWASP LLM Top 10 (2025): Prompt Injection, data_sharing_level уровни, MCP allowed_tools scopes, HTML sanitization, DFS cycle detection, тест-векторы, pre-deploy чеклист.
  ↳ Аудит: рейтинг до хардненинга 4.1/10 · DDL отсутствует — все поля в Master §6
  ↳ Связи: [[onitask_Architecture_Master_]] §3, §6.4, §6.16 · [[onitask_ai_]] §2.2–2.3, §3.4, §5.1 · [[onitask_mcp_contract_]] §2, §4–6 · [[onitask_bot]] §5.6, §6.2–6.3

---

## 🛠 Dev Process (разработка самого onitask)

*Отдельный слой — не продукт onitask, а то, как он собирается.*

- [[onitask_Dev_Flow_7_2]] · v7.2 · Операционный манифест
  Cline Plan/Act Mode, канонический Memory Bank (6 файлов), Karpathy Loop, Shadow Evaluator/Антагонист, нотация задач (`ID #тег !приоритет @blocked_by`), gate атомарности коммита.

- `01-detailed-flow.md` — декомпозиция задач по этапам, читается на каждом Шаге 0 согласно [[onitask_Dev_Flow_7_2]].

- [[onitask_dev_setup]] · v0.2.1 · актуализировано
  Технологический стек, структура проекта, build sequence, типизация Supabase (CI), переменные окружения, §7 API-контракты MVP.
  ↳ Схема: [[onitask_Architecture_Master_]] §4–9 · AI-модули: [[onitask_ai_]] · MCP: [[onitask_mcp_contract_]]

---

## 🗺 Индекс задач ("что делаю → что читаю")

Полная операционная таблица по всем доменам (Security, БД, Relational Context Layer, AI-модули, Flow Board, MCP, Bot, Продукт, Dev Setup) — в [[onitask_INDEX_]].
Этот файл держит версии и changelog как единственный источник правды по номерам версий каждого документа.

---

## 📊 Версии

Версии и статусы каждого документа проставлены рядом с ним в соответствующих разделах выше. Единственный источник правды по номерам версий и changelog — [[onitask_INDEX_]]; отдельная сводная таблица здесь не хранится, чтобы не создавать второй источник, который может разойтись с INDEX.

**Легенда статусов:**
- ✅ Production-Ready / Утверждён / Источник истины — можно использовать как основание для реализации без дополнительной проверки.
- 🟡 Концепт / Pre-Spec — требует уточнения или доработки перед реализацией; сверяться с автором перед тем, как опираться на детали.
- ⚠️ Deprecated — не использовать как источник для новой реализации; сохранён только как справочник (см. пометку у документа).

---

## 🧭 Как читать этот MOC

1. **Новая фича** → начни с [[onitask_Architecture_Master_]] (инварианты + схема), затем нужный Feature Spec, затем — если есть — Операционное приложение.
2. **Баг/аномалия в проде** → [[onitask_sql_anomalies_]] → интерпретация в [[onitask_flow_]].
3. **Работа с агентами (MCP)** → [[onitask_mcp_contract_]] → [[onitask_security_]] §3 (allowed_tools, rate limit).
4. **Вопрос "а как вообще устроен процесс разработки"** → [[onitask_Dev_Flow_7_2]], не эти доки — они про продукт, не про то, как его пишут.
5. **Не знаешь, где искать конкретную задачу** → [[onitask_INDEX_]], раздел "Что делаю → что читаю".

---

*MOC · onitask · синхронизирован с INDEX v2.7.3*
