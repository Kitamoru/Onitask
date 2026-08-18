'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Copy, Trash2, KeyRound, Plus, LinkIcon } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface McpKeyInfo {
  keyHash: string;
  name: string;
  created_at: string;
  expires_at: string;
  prefix: string;
  workspace_name: string;
}

interface CreateKeyResponse {
  success: boolean;
  keyId?: string;
  plaintextKey?: string;
  prefix?: string;
  error?: string;
}

interface DeleteKeyResponse {
  success: boolean;
  error?: string;
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Fetch all MCP keys (without workspace filter for now).
 * In future: can add workspace filtering when workspace context is available.
 */
async function fetchMcpKeys(): Promise<McpKeyInfo[]> {
  const res = await fetch(`/api/mcp-keys`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.keys ?? [];
}

async function createMcpKey(name: string): Promise<CreateKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  return res.json();
}

async function deleteMcpKey(keyHash: string): Promise<DeleteKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys/${encodeURIComponent(keyHash)}`,
    { method: 'DELETE' },
  );
  return res.json();
}

// ============================================================================
// Components
// ============================================================================

/**
 * McpKeyItem — simple key card (no copy/delete buttons).
 * Clicking navigates to key detail view.
 */
function McpKeyItem({
  keyInfo,
}: {
  keyInfo: McpKeyInfo;
}) {
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Check if key is expired
  const isExpired = new Date(keyInfo.expires_at) < new Date();
  const expiryColor = isExpired ? '#EF4444' : 'var(--color-text-secondary)';

  return (
    <div
      className="relative w-full px-3 py-3 transition-opacity hover:opacity-90 active:opacity-70 cursor-pointer"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
        border: '1px solid var(--color-line)',
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
      role="button"
      tabIndex={0}
      aria-label={`Ключ ${keyInfo.name || keyInfo.prefix}`}
    >
      <div className="flex flex-col gap-1">
        <span
          className="text-base font-medium leading-5 text-white truncate"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {keyInfo.name || `Ключ ${keyInfo.prefix}`}
        </span>
        <span
          className="text-xs font-medium leading-3"
          style={{ color: expiryColor }}
        >
          {keyInfo.workspace_name} · {formatDate(keyInfo.expires_at)}
        </span>
      </div>
    </div>
  );
}

/**
 * CopyButton — secondary button with copy icon for "Шаблон подключения".
 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center gap-2 h-10 w-full transition-opacity hover:opacity-80 active:opacity-60"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
        border: '1px solid var(--color-line)',
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
      aria-label={label}
    >
      <span
        className="text-[14px] font-semibold text-white"
        style={{ fontFamily: 'var(--font-family-display)' }}
      >
        {label}
      </span>
      {copied ? (
        <span className="text-xs font-medium" style={{ color: '#22C55E' }}>✓</span>
      ) : (
        <Copy className="w-5 h-5 shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
      )}
    </button>
  );
}

/**
 * AddKeyButton — primary button to create a new key. Always visible.
 */
function AddKeyButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center justify-center gap-2 h-10 w-full transition-opacity hover:opacity-90 active:opacity-70 disabled:opacity-50"
      style={{
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        backgroundColor: '#FAFAFA',
      }}
      aria-label="Добавить ключ"
    >
      <span
        className="text-[14px] font-semibold"
        style={{ color: '#0A0A0A', fontFamily: 'var(--font-family-display)' }}
      >
        {loading ? 'Создание...' : 'Добавить ключ'}
      </span>
      {!loading && <Plus className="w-5 h-5 text-black shrink-0" />}
    </button>
  );
}

/**
 * ConnectionTemplate — shows the connection template example.
 */
function ConnectionTemplate() {
  const template = `curl -X POST https://your-workspace.vercel.app/api/mcp/create_task \\
  -H "Authorization: Bearer sk_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspace_id": "YOUR_WORKSPACE_ID",
    "agent_name": "your-agent-name",
    "title": "Task title",
    "description": "Task description"
  }'`;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-2 w-full px-3 py-2">
        <div className="h-[18px] w-[2px]" style={{ backgroundColor: '#F59E0B' }} aria-hidden="true" />
        <span
          className="text-base font-medium leading-5"
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-display)',
          }}
        >
          Шаблон подключения
        </span>
      </div>

      <div
        className="relative p-3 rounded-md font-mono text-xs leading-relaxed overflow-auto"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--color-line)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <pre className="whitespace-pre-wrap break-all">{template}</pre>
      </div>

      <CopyButton text={template} label="Копировать шаблон" />
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function McpSettingsPage() {
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [freshKey, setFreshKey] = useState<{ key: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load keys on mount (no workspace dependency)
  useEffect(() => {
    let cancelled = false;
    fetchMcpKeys().then((data) => {
      if (!cancelled) setKeys(data);
    });
    return () => { cancelled = true; };
  }, []);

  const handleAddKeyClick = useCallback(() => {
    performCreateKey();
  }, []);

  const performCreateKey = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await createMcpKey(`Ключ ${new Date().toLocaleTimeString('ru-RU')}`);
      if (result.success && result.plaintextKey && result.prefix) {
        setFreshKey({ key: result.plaintextKey, prefix: result.prefix });
        // Refresh keys list
        const updated = await fetchMcpKeys();
        setKeys(updated);
      } else {
        setError(result.error ?? 'Неизвестная ошибка');
      }
    } catch {
      setError('Не удалось создать ключ');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeleteKey = useCallback(async (keyHash: string) => {
    setError(null);
    try {
      const result = await deleteMcpKey(keyHash);
      if (result.success) {
        const updated = await fetchMcpKeys();
        setKeys(updated);
      } else {
        setError(result.error ?? 'Не удалось удалить ключ');
      }
    } catch {
      setError('Не удалось удалить ключ');
    }
  }, []);

  const handleCopyKey = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, []);

  const handleCopyFreshKey = useCallback(async () => {
    if (freshKey) {
      await handleCopyKey(freshKey.key);
      setTimeout(() => setFreshKey(null), 3000);
    }
  }, [freshKey, handleCopyKey]);

  return (
    <main
      className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
      style={{
        paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
        paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
      }}
    >
      <div className="flex flex-col gap-6 px-4 pb-[64px] pt-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-white" style={{ fontFamily: 'var(--font-family-display)' }} />
          <h1
            className="text-xl font-semibold text-white"
            style={{ fontFamily: 'var(--font-family-display)' }}
          >
            Подключение MCP
          </h1>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="px-3 py-2 rounded-md text-sm"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#EF4444',
            }}
          >
            {error}
          </div>
        )}

        {/* Fresh key notification */}
        {freshKey && (
          <div
            className="flex items-center justify-between px-3 py-3 rounded-md"
            style={{
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
            }}
          >
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: '#22C55E' }}>
                ✓ Новый ключ создан
              </span>
              <span
                className="text-sm font-mono break-all"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {freshKey.key}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Скопируйте ключ — он покажется только один раз
              </span>
            </div>
            <button
              onClick={handleCopyFreshKey}
              className="flex items-center justify-center w-8 h-8 rounded-sm"
              style={{ color: '#22C55E' }}
              aria-label="Копировать"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Мои ключи section */}
        <div className="flex flex-col gap-3 w-full">
          <div className="flex items-center gap-2 w-full px-3 py-2">
            <div className="h-[18px] w-[2px]" style={{ backgroundColor: '#F59E0B' }} aria-hidden="true" />
            <span
              className="text-base font-medium leading-5"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-display)',
              }}
            >
              Мои ключи
            </span>
          </div>

          {loading ? (
            <div
              className="flex items-center justify-center h-10 w-full"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 6,
                border: '1px solid var(--color-line)',
              }}
            >
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Загрузка...</span>
            </div>
          ) : keys.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-8 gap-2 w-full"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 6,
                border: '1px dashed var(--color-line)',
              }}
            >
              <LinkIcon className="w-8 h-8" style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Нет активных ключей
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 w-full">
                {keys.map((keyInfo) => (
                  <McpKeyItem
                    key={keyInfo.keyHash}
                    keyInfo={keyInfo}
                  />
                ))}
              </div>

              <AddKeyButton onClick={handleAddKeyClick} loading={loading} />
            </>
          )}
        </div>

        {/* Connection template */}
        <ConnectionTemplate />

        {/* Bottom filler for safe area */}
        <div className="h-16" aria-hidden="true" />
      </div>
    </main>
  );
}