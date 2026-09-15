# Ручное регрессионное тестирование: REV-01 (review) + SUBMIT-01 (сдача) + файлы

> Scope: фичи `bc19439` (REV-01) и `d5bab70` (SUBMIT-01) + регрессия файлового функционала,
> который могли задеть миграции 082/083/085 (`task_attachments.submission_id`).
> Лог: отмечайте `- [x]` и комментарий в конце строки (имя тестировщика / дата / отклонение).

## 0. Автопокрытие (уже зелёное — руками не дублируем)

- [x] vitest: 28 passed (18 — наши: `tests/lib/reviewDecision` 8, `tests/api/tasks/review` 10), 4 known-red `init.test.ts` (AUTH-03, вне скоупа)
- [x] tsc: 0 ошибок
- [x] SQL smoke (см. §E): структура + сигнатуры RPC + негативные вызовы — PASS

## A. REV-01 — Review-решение из TWA (P1)

Предусловия: воркспейс с 2+ участниками; задача исполнителя X проверяет Y; TWA открыта у обоих.

- [ ] **A1 (P1) Видимость блока.** Откройте задачу в `review` назначенным ревьюером → виден блок «Ревью решения» с префиллом сдачи (текст, ссылки, «📎 N файл(ов)»). Под другим пользователем (не ревьюер, не creator, не admin) → строка «На проверке · дождитесь решения назначенного ревьюера», кнопок нет.
- [ ] **A2 (P1) Approve.** Ревьюер жмёт «✔ Согласовать» → задача уходит в `done`, Version++ в БД, последняя `task_submissions.status='accepted'`, `accepted_by/accepted_at` заполнены. UI карточки обновился без F5.
- [ ] **A3 (P1) Fix.** «✖ Вернуть на доработку» → поле причины → «Подтвердить возврат» → задача в `in_progress`, в комментариях появился комментарий `source='review'` с текстом причины, агент/исполнитель получил requeue (см. dispatch_outbox), Version++.
- [ ] **A4 (P1) Fix без причины.** Кнопка «Подтвердить возврат» disabled при пустой причине; запрос `POST /api/tasks/[id]/review {action:'fix', reason:''}` → 400 (проверка в DevTools Network).
- [ ] **A5 (P1) Creator-backfill.** Задача в `review`, `reviewer_id = NULL` → creator видит кнопки и может approve; другой участник — нет.
- [ ] **A6 (P2) Admin/owner форс-мейдж.** Owner/admin видит кнопки на чужой задаче с назначенным ревьюером и может approve/fix.
- [ ] **A7 (P1) Version conflict.** Открыть карточку у двух клиентов; вторым сдвинуть/изменить задачу; первым нажать Approve → ошибка «Версия задачи изменилась. Обновите данные и повторите.» (409). После перезагрузки карточки — approve проходит.
- [ ] **A8 (P1) Double-review (410).** Две вкладки у ревьюера: approve в первой, затем approve во второй → «Задача больше не на проверке» (410 `already_processed`).
- [ ] **A9 (P1) Auth/tenancy.** Пользователь другого воркспейса: `POST /api/tasks/[id]/review` → 403; без `x-init-data` → 401.
- [ ] **A10 (P3) Invalid action.** `POST … {action:'delete'}` → 400 «Недопустимое действие».

## B. SUBMIT-01 — Сдача исполнителя (P1)

- [ ] **B1 (P1) Открытие шага «Результат».** Drag карточки из `backlog`/`in_progress` в `review` → открывается `ResultStepSheet`; колонка НЕ меняется, пока сдача не отправлена.
- [ ] **B2 (P1) Отмена шага.** Закрыть ResultStepSheet → задача остаётся в исходной колонке, версия не изменилась.
- [ ] **B3 (P1) Сдача в review с файлами и ссылками.** Текст + ссылка + 2 файла → submission создан (`target_column='review'`), задача в `review`, ревьюеру ушёл Telegram-карточка (миграция 083: `body_text` как reason), вложения получили `submission_id`.
- [ ] **B4 (P2) Сдача напрямую в done.** Drag в `done` из не-review колонки → ResultStepSheet, сдача `target_column='done'`, задача в `done`.
- [ ] **B5 (P2) Ошибка загрузки файла.** Оборвать сеть/недопустимый файл → понятная ошибка в ResultStepSheet, задача не сдвинулась, submission не создан.
- [ ] **B6 (P2) Повторная сдача.** Сдать снова после fix → новая строка в `task_submissions` (история иммутабельна), GET `submissions` возвращает последнюю.
- [ ] **B7 (P1) Notify на сдачу.** В Telegram-чате воркспейса появилась карточка ревью с текстом сдачи (без дублей при ретрае).

## C. Файлы/вложения — регрессия (могли сломать миграции 082/083)

- [ ] **C1 (P1) Старый flow вложений к задаче.** Прикрепить файл к задаче БЕЗ сдачи (кнопка вложений в TaskViewEdit) → строка в `task_attachments` c `submission_id = NULL`, файл открывается по `storage_path`, download-token работает.
- [ ] **C2 (P1) Файлы сдачи.** Файлы из B3: в `task_attachments` `submission_id` заполнен; в карточке ревью `files_count` совпадает с числом.
- [ ] **C3 (P2) Файлы живут после approve.** После A2 вложения доступны в карточке/истории, не отвязались.
- [ ] **C4 (P2) Вложения через бота.** Отправить файл боту (bot_attach_pending flow) → вложение прикрепилось к задаче, старый flow не сломан (миграции не должны были задеть).
- [ ] **C5 (P3) RLS изоляция.** Пользователь чужого воркспейса не видит вложения/сдачи (`task_attachments`, `task_submissions`) ни в UI, ни в API.

## D. Смежные регрессии (P2)

- [ ] **D1 (P2) History/version.** При каждом решении (approve/fix) и сдаче: запись в `task_column_history`, `tasks.version` инкрементируется ровно на 1 (проверить в БД или через карточку).
- [ ] **D2 (P2) Telegram-уведомления.** При попадании в `review` — карточка ревью исполнителю/чату; при approve — `task_done`-уведомление; при fix — нет дублей.
- [ ] **D3 (P2) Свайпы отключены.** `features.ts: TASK_SWIPE_ENABLED=false` — свайп карточки не двигает задачу и не открывает ResultStepSheet; drag&drop работает штатно.
- [ ] **D4 (P1) Review→done через drag.** Drag из `review` в `done` НЕ открывает ResultStepSheet (это решает ревьюер через ReviewDecisionBlock, не ResultStepSheet). Если позволяет UI — drag в `done` из `review` должен идти по старому каналу движения.
- [ ] **D5 (P2) Задача не в review — блока нет.** В колонках `done`/`backlog`/`in_progress` блок ReviewDecisionBlock не рендерится (модель `canCurrentUserReview` отсекает по `column`).
- [ ] **D6 (P3) Escalation/human_override.** Задача с `needs_human=true` в review — блок ревью не блокирует существующие сценарии эскалации.

## E. SQL smoke — выполнено 2026-09-14 (PASS)

- [x] Структура: `task_submissions` ✓, `task_attachments.submission_id` ✓, `task_submissions.target_column` ✓, RPC `submit_task`+`review_action` ✓
- [x] Сигнатуры: `review_action(p_task_id, p_action, p_version, p_actor_worker_id, p_reason DEFAULT NULL)`; `submit_task(p_task_id, p_profile_id, p_target_column, p_body_text, p_links, p_attachment_ids, p_expected_version, p_edited)` — соответствуют вызовам из route ✓
- [x] Негатив `review_action` (несуществующий task) → `{"success":false,"error":"not_found"}` (мягкий jsonb → route мапит 404) ✓
- [x] Негатив `submit_task` (несуществующий task) → `RAISE EXCEPTION 'task_not_found'` (P0001) — стиль отличается от review_action, но `submit/route.ts:mapRpcError` статически проверен: `task_not_found`→404, `not_a_workspace_member`→403, `invalid_target_column`/`same_column`→400, `version_conflict`→409, `review_approval_required`→403 ✓

## Примечания для тестировщика

- Ключевые env: TWA должна быть собрана с актуальным `origin/main` (`d5bab70`).
- Ошибки route review по кодам: 400 invalid_action/причина, 401 auth, 403 forbidden/tenancy, 404 not_found, 409 version_conflict, 410 already_processed.
- Смоук `submit_task` показал: RPC кидает исключения (в отличие от review_action) — если увидите 500 вместо 404 на краевых случаях сдачи, это баг в маппинге `submit/route.ts`, заводим баг.
- Не трогать production-данные демо-воркспейса: использовать тестовый воркспейс.
