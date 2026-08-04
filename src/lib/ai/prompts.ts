/**
 * F-04 Parse Prompt builder.
 *
 * Based on: onitask_ai_.md §3.4 (Parse Prompt for Groq llama-3.3-70b-versatile)
 * Security: JSON.stringify() for all dynamic strings (product_vision §8.4)
 */

interface WorkerInfo {
  id: string;
  display_name: string;
}

interface SettingsInfo {
  workspace_context: string | null;
  workspace_context_cache: string | null;
  data_sharing_level: string;
}

/**
 * Build the F-04 Parse Prompt for Groq llama-3.3-70b-versatile.
 *
 * The prompt instructs the model to parse user input into a structured task
 * and respond in JSON format (JSON mode enforced at API call level).
 */
export function buildParsePrompt(
  userInput: string,
  settings: SettingsInfo,
  workers: WorkerInfo[],
): string {
  const sharingLevel = settings.data_sharing_level ?? 'standard';

  // workspace_context — manual Admin context (persistent, domain and stack)
  const workspaceContextBlock = settings.workspace_context
    ? `КОНТЕКСТ КОМАНДЫ:\n${JSON.stringify(settings.workspace_context)}\n` +
      `Используй для оценки complexity и формулировки rewritten_title/description. ` +
      `Не выходи за рамки управления задачами.`
    : '';

  // workspace_context_cache — operational snapshot (sprint, load, blockers)
  // 'minimal': cache contains display_name → don't send to provider
  const workspaceContextCacheBlock =
    settings.workspace_context_cache && sharingLevel !== 'minimal'
      ? `ОПЕРАТИВНОЕ СОСТОЯНИЕ КОМАНДЫ:\n${JSON.stringify(settings.workspace_context_cache)}\n` +
        `Используй для уточнения assignee и priority если явно не указаны в запросе пользователя.`
      : '';

  const teamBlock = workers.length
    ? `УЧАСТНИКИ КОМАНДЫ (используй display_name для поля assignee):\n` +
      workers.map((w) => `- ${w.display_name}`).join('\n')
    : '';

  return `
<role>
Ты — ассистент onitask. Преобразуй ввод пользователя в структурированную задачу.
Отвечай ТОЛЬКО valid JSON без markdown, без пояснений.
Today: ${new Date().toISOString().split('T')[0]}.
</role>

<context>
${workspaceContextBlock}
${workspaceContextCacheBlock}
${teamBlock}
</context>

<instructions>
<extraction_rules>
1. title: краткое название задачи в императивной форме.
2. column: 'backlog' если не указано явно.
3. priority: извлекай из слов «срочно», «важно», «до пятницы» и т.д.
4. assignee: display_name из УЧАСТНИКИ КОМАНДЫ если упомянут явно
   или очевидно следует из контекста. Иначе null.
5. deadline: YYYY-MM-DD или null.
6. tags: извлечённые технические метки.
7. confidence: 0.0–1.0, уверенность в правильном извлечении структурных полей.
</extraction_rules>

<rewriting_rules>
8. rewritten_title: начинается с глагола-действия, максимально конкретный, ≤75 символов.
   Примеры:
   · «разобраться с багом в платёжке» → «Исправить ошибку обработки Stripe webhook»
   · «курсору поправить тесты» → «Cursor: обновить unit-тесты после рефакторинга auth»
   · «надо авторизацию» → «Реализовать OAuth авторизацию через Telegram»
   · «что-то с деплоем» → «Исследовать причину падения деплоя на staging»
9. rewritten_description: одно предложение контекста (ЗАЧЕМ / что это)
   + маркированный список шагов. Если ввод неразборчив — пустая строка.
   Первое предложение не дублирует rewritten_title — даёт фрейм для пунктов.

   · clarity_score ≈ 0.2 → rewritten_description: ""
   · clarity_score ≈ 0.55 →
     "Проблема в цепочке авторизации бота — нужно изолировать слой.
      - Воспроизвести сценарий: /start → initData → /api/init
      - Проверить логи Supabase Auth на 401/403
      - Изолировать: validateTelegramInitData или Supabase client?"
   · clarity_score ≈ 0.9 →
     "Добавить валидацию email в форму регистрации до отправки на сервер.
      - Добавить regex-проверку email в TaskForm.tsx
      - Показать inline-ошибку при невалидном формате до submit
      - Написать unit-тест на validateEmail()"

10. clarity_score: оценка ясности намерения пользователя:
    0.9–1.0: конкретное, actionable
    0.6–0.8: понятно направление, без деталей
    0.3–0.5: неясно что именно делать
    0.0–0.2: бессмысленный или нерелевантный текст
11. complexity:
    1 = одно действие без зависимостей
    2 = несколько шагов или внешняя зависимость
    3 = кросс-модульная или значительная неопределённость
</rewriting_rules>
</instructions>

<output_schema>
{
  "title":                 string,
  "column":                "backlog" | "in_progress" | "review",
  "priority":              "high" | "medium" | "low" | null,
  "assignee":              string | null,
  "deadline":              string | null,
  "tags":                  string[],
  "confidence":            number,
  "rewritten_title":       string,
  "rewritten_description": string,
  "clarity_score":         number,
  "complexity":            1 | 2 | 3
}
</output_schema>

<user_input>
${JSON.stringify(userInput)}
</user_input>
`.trim();
}