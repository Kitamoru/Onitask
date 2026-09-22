'use client';

/**
 * AgentConnectorSheet — «Добавить агента» прямо с Flow Board (Stage 15).
 *
 * Раньше кнопка вела на /settings/mcp (шаблон MCP-ключа для pull-рантайма).
 * Теперь это форма коннектора: Название + URL + API Key → бесплатный probe
 * (GET {url}/models, 0 токенов) → создание коннектора и воркера, после чего
 * агент появляется в секции «Агенты» и его можно выбирать исполнителем.
 *
 * Показываем только те поля, которые нужны человеку: ключ уходит в Vault и
 * наружу не возвращается (в UI после создания видна лишь маска).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, TextInput } from '@/components/ui/desk-ui';
import { createAgent } from '@/lib/api/agents';

const NAME_MAX_LENGTH = 60;

type SheetState = 'idle' | 'saving' | 'done';

/** Коды probe → человекочитаемые причины (совпадают с agentEndpoint). */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_url: 'URL не разобран — проверьте формат.',
  url_not_https: 'Разрешён только https.',
  url_has_credentials: 'Логин/пароль в URL запрещены.',
  url_has_query: 'Query-параметры в URL запрещены.',
  host_not_allowed: 'Внутренние адреса запрещены.',
  host_unresolvable: 'Не удалось разрешить домен.',
  redirect_blocked: 'Сервис отвечает редиректом — укажите конечный адрес API.',
  unauthorized: 'Ключ отклонён сервисом — проверьте API Key.',
  models_not_found: 'По этому URL нет OpenAI-совместимого API.',
  server_error: 'Сервис недоступен — повторите позже.',
  timeout: 'Сервис не ответил за 10 секунд.',
  unreachable: 'Не удалось подключиться к сервису.',
  bad_response: 'Сервис вернул неожиданный ответ.',
  agent_name_taken: 'Агент с таким названием уже подключён к этой доске.',
  mcp_key_conflict:
    'На это имя выдан MCP-ключ pull-рантайма — отзовите его или выберите другое название.',
  invalid_agent_name: 'Проверьте название агента.',
  invalid_limits: 'Проверьте лимиты.',
  invalid_mcp_allowlist: 'Проверьте список инструментов.',
  admin_required: 'Добавлять агентов может владелец или админ доски.',
  forbidden: 'Нет доступа к этой доске.',
  secret_store_failed: 'Не удалось сохранить ключ — попробуйте ещё раз.',
};

export interface AgentConnectorSheetProps {
  open: boolean;
  onClose: () => void;
  /** Текущая доска; без неё создание невозможно */
  workspaceId: string | null;
  /** Вызывается после успешного создания (обновить данные борды) */
  onCreated?: () => void;
}

function successHaptic() {
  void (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
}

function errorHaptic() {
  void (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
}

export function AgentConnectorSheet({
  open,
  onClose,
  workspaceId,
  onCreated,
}: AgentConnectorSheetProps) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [state, setState] = useState<SheetState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setShowAdvanced(false);
    setState('idle');
    setError(null);
  }, [open]);

  const canSubmit =
    state !== 'saving' &&
    Boolean(workspaceId) &&
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!workspaceId) {
      setError('Не выбрана доска.');
      return;
    }

    setState('saving');
    setError(null);

    // Сервер сначала делает бесплатный probe (GET /models) и только потом пишет
    // в БД: при ошибке ничего не создаётся — ни коннектора, ни воркера.
    const result = await createAgent({
      workspaceId,
      agentName: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim() || undefined,
    });

    if (result.error || !result.data) {
      setState('idle');
      setError(
        ERROR_MESSAGES[result.error ?? ''] ??
          result.message ??
          'Не удалось добавить агента.',
      );
      errorHaptic();
      return;
    }

    setState('done');
    successHaptic();
    onCreated?.();
  }, [workspaceId, name, baseUrl, apiKey, model, onCreated]);

  const handleClose = useCallback(() => {
    setState('idle');
    setError(null);
    onClose();
  }, [onClose]);

  const isSaving = state === 'saving';

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div className="flex flex-col gap-5 p-4 pb-8">
        <div className="flex flex-col gap-1">
          <h2
            style={{
              fontFamily: 'var(--font-family-display)',
              fontSize: 'var(--text-body-lg)',
              color: 'var(--color-text-primary)',
            }}
          >
            Добавить агента
          </h2>
          <p className="text-sm text-text-muted">
            Onitask сам отправит задачу на endpoint агента и заберёт результат. Связь
            проверяется бесплатно — без расхода токенов.
          </p>
        </div>

        {state === 'done' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              Агент «{name.trim()}» добавлен на доску — задачи можно ставить ему как
              исполнителю.
            </p>
            <Button variant="solid" className="w-full" onClick={handleClose} type="button">
              Готово
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Название">
              <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={NAME_MAX_LENGTH}
                placeholder="Например: Drift"
                disabled={isSaving}
              />
            </Field>

            <Field label="URL агента">
              <TextInput
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://drift.neuraldeep.ru/v1"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={isSaving}
              />
            </Field>

            <Field label="API Key">
              <TextInput
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="dft_…"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={isSaving}
              />
            </Field>

            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="self-start text-sm text-text-muted underline underline-offset-2"
            >
              {showAdvanced ? 'Скрыть дополнительно' : 'Дополнительно'}
            </button>

            {showAdvanced && (
              <Field label="Модель (необязательно)">
                <TextInput
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Определится автоматически"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={isSaving}
                />
              </Field>
            )}

            {error && (
              <p className="text-sm" style={{ color: 'var(--color-error)' }}>
                {error}
              </p>
            )}

            <Button
              variant="solid"
              className="w-full"
              onClick={handleSubmit}
              disabled={!canSubmit}
              type="button"
            >
              {isSaving ? 'Проверяем связь…' : 'Добавить'}
            </Button>

            <p className="text-xs text-text-muted">
              Ключ хранится на сервере (Vault) и никогда не показывается в интерфейсе.
            </p>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
      {children}
    </div>
  );
}
