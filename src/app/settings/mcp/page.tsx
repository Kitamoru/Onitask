'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Copy, Trash2, KeyRound, Plus, Link as LinkIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

// ============================================================================
// Types
// ============================================================================

interface McpKeyInfo {
  keyHash: string;
  name: string;
  created_at: string;
  prefix: string;
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

async function fetchMcpKeys(workspaceId: string): Promise<McpKeyInfo[]> {
  const res = await fetch(`/api/mcp-keys?workspace_id=${encodeURIComponent(workspaceId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.keys ?? [];
}

async function createMcpKey(workspaceId: string, name: string): Promise<CreateKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys?workspace_id=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  return res.json();
}

async function deleteMcpKey(workspaceId: string, keyHash: string): Promise<DeleteKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys/${encodeURIComponent(keyHash)}?workspace_id=${encodeURIComponent(workspaceId)}`,
    { method: 'DELETE' },
  );
  return res.json();
}

// ============================================================================
// Components
// ============================================================================

/**
 * McpKeyItem — single key row from Figma mcp-item template.
 */
function McpKeyItem({
  keyInfo,
  onCopy,
  onDelete,
}: {
  keyInfo: McpKeyInfo;
  onCopy: (text: string) => void;
  onDelete: (keyHash: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopy(keyInfo.keyHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  return (
    <div
      className="relative flex items-center justify-between w-full px-3 py-3 transition-opacity hover:opacity-90 active:opacity-70"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
        border: '1px solid var(--color-line)',
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
    >
      <div className="flex flex-col gap-1 pr-3">
        <span
          className="text-base font-medium leading-5 text-white"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {keyInfo.name || `Ключ ${keyInfo.prefix}`}
        </span>
        <span className="text-xs font-medium leading-3" style={{ color: 'var(--color-text-secondary)' }}>
          {formatDate(keyInfo.created_at)} · {keyInfo.prefix}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleCopy}
          className="flex items-center justify-center w-8 h-8 rounded-sm transition-colors hover:bg-opacity-10 active:bg-opacity-20"
          style={{
            color: 'var(--color-text-secondary)',
            backgroundColor: copied ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
          }}
          aria-label="Копировать ключ"
          title={copied ? 'Скопировано!' : 'Копировать'}
        >
          {copied ? (
            <span className="text-xs font-medium" style={{ color: '#22C55E' }}>✓</span>
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => onDelete(keyInfo.keyHash)}
          className="flex items-center justify-center w-8 h-8 rounded-sm transition-colors hover:bg-red-500/10 active:bg-red-500/20"
          style={{ color: 'var(--color-text-secondary)' }}
          aria-label="Удалить ключ"
          title="Удалить"
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
 * AddKeyButton — primary button to create a new key.
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
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace_id') ?? '';

  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [freshKey, setFreshKey] = useState<{ key: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    if (!workspaceId) return;
    const data = await fetchMcpKeys(workspaceId);
    setKeys(data);
  }, [workspaceId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleAddKey = useCallback(async () => {
    if (!workspaceId) {
      setError('Workspace ID не указан');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await createMcpKey(workspaceId, `Ключ ${new Date().toLocaleTimeString('ru-RU')}`);
      if (result.success && result.plaintextKey && result.prefix) {
        setFreshKey({ key: result.plaintextKey, prefix: result.prefix });
        await loadKeys();
      } else {
        setError(result.error ?? 'Неизвестная ошибка');
      }
    } catch {
      setError('Не удалось создать ключ');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, loadKeys]);

  const handleDeleteKey = useCallback(async (keyHash: string) => {
    if (!workspaceId) return;
    setError(null);
    try {
      const result = await deleteMcpKey(workspaceId, keyHash);
      if (result.success) {
        await loadKeys();
        setFreshKey((prev) => (prev?.key.startsWith(keyHash.slice(0, 8)) ? null : prev));
      } else {
        setError(result.error ?? 'Не удалось удалить ключ');
      }
    } catch {
      setError('Не удалось удалить ключ');
    }
  }, [workspaceId, loadKeys]);

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

  if (!workspaceId) {
    return (
      <main
        className="min-h-[var(--tg-viewport-stable-height,100dvh)] bg-bg"
        style={{
          paddingTop: 'max(64px, var(--tg-content-safe-top, 0px))',
          paddingBottom: 'calc(var(--size-bottom-menu-height) + 16px)',
        }}
      >
        <div className="flex flex-col gap-6 px-4 pb-[64px] pt-6">
          <div
            className="px-3 py-3 rounded-md text-sm"
            style={{
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#F59E0B',
            }}
          >
            Выберите рабочее пространство для управления MCP ключами
          </div>
        </div>
      </main>
    );
  }

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
            MCP Keys
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

        {/* Keys list */}
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
              Активные ключи
            </span>
          </div>

          {keys.length === 0 && !freshKey ? (
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
            <div className="flex flex-col gap-2 w-full">
              {keys.map((keyInfo) => (
                <McpKeyItem
                  key={keyInfo.keyHash}
                  keyInfo={keyInfo}
                  onCopy={handleCopyKey}
                  onDelete={handleDeleteKey}
                />
              ))}
            </div>
          )}

          <AddKeyButton onClick={handleAddKey} loading={loading} />
        </div>

        {/* Connection template */}
        <ConnectionTemplate />

        {/* Bottom filler for safe area */}
        <div className="h-16" aria-hidden="true" />
      </div>
    </main>
  );
}