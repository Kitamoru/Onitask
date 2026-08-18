'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Copy, KeyRound, LinkIcon } from 'lucide-react';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { AddMcpKeySheet } from '@/components/settings/AddMcpKeySheet';

// ============================================================================
// Types
// ============================================================================

interface McpKeyInfo {
  keyHash: string;
  name: string;
  created_at: string;
  expires_at: string;
  prefix: string;
  workspace_id: string;
  workspace_name: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

interface CreateKeyResponse {
  success: boolean;
  keyId?: string;
  plaintextKey?: string;
  prefix?: string;
  name?: string;
  workspace_id?: string;
  error?: string;
}

interface DeleteKeyResponse {
  success: boolean;
  error?: string;
}

// ============================================================================
// API Helpers (all use Telegram initData auth)
// ============================================================================

async function fetchMcpKeys(initData: string): Promise<McpKeyInfo[]> {
  const res = await fetch(`/api/mcp-keys?init_data=${encodeURIComponent(initData)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.keys ?? [];
}

async function fetchWorkspaces(initData: string): Promise<WorkspaceOption[]> {
  const res = await fetch(`/api/workspaces/list?init_data=${encodeURIComponent(initData)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data?.workspaces?.map((ws: any) => ({ id: ws.id, name: ws.name })) ?? [];
}

async function createMcpKey(
  initData: string,
  name: string,
  workspaceId: string,
  expiresInDays: number,
): Promise<CreateKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys?init_data=${encodeURIComponent(initData)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, workspace_id: workspaceId, expires_in_days: expiresInDays }),
    },
  );
  return res.json();
}

async function deleteMcpKey(
  initData: string,
  keyHash: string,
): Promise<DeleteKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys/${encodeURIComponent(keyHash)}?init_data=${encodeURIComponent(initData)}`,
    { method: 'DELETE' },
  );
  return res.json();
}

// ============================================================================
// Components
// ============================================================================

function McpKeyItem({ keyInfo }: { keyInfo: McpKeyInfo }) {
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
        <span className="text-xs font-medium leading-3" style={{ color: expiryColor }}>
          {keyInfo.workspace_name} · {formatDate(keyInfo.expires_at)}
        </span>
      </div>
    </div>
  );
}

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
  const { isLoading: authLoading, initData: tgInitData } = useTelegramAuth();
  const [keys, setKeys] = useState<McpKeyInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [freshKey, setFreshKey] = useState<{ key: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddSheet, setShowAddSheet] = useState(false);

  // Load keys and workspaces once initData is available
  useEffect(() => {
    if (authLoading) return;
    if (!tgInitData) {
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    let cancelled = false;
    Promise.all([fetchMcpKeys(tgInitData), fetchWorkspaces(tgInitData)]).then(([data, ws]) => {
      if (!cancelled) {
        setKeys(data);
        setWorkspaces(ws);
        setInitialLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setInitialLoading(false);
    });
    return () => { cancelled = true; };
  }, [tgInitData, authLoading]);

  const handleCreateKey = useCallback(async (name: string, workspaceId: string, expiresInDays: number) => {
    if (!tgInitData) return;
    setError(null);
    setLoading(true);
    try {
      const result = await createMcpKey(tgInitData, name, workspaceId, expiresInDays);
      if (result.success && result.plaintextKey && result.prefix) {
        setFreshKey({ key: result.plaintextKey, prefix: result.prefix });
        const updated = await fetchMcpKeys(tgInitData);
        setKeys(updated);
      } else {
        setError(result.error ?? 'Неизвестная ошибка');
      }
    } catch {
      setError('Не удалось создать ключ');
    } finally {
      setLoading(false);
    }
  }, [tgInitData]);

  const handleDeleteKey = useCallback(async (keyHash: string) => {
    if (!tgInitData) return;
    setError(null);
    try {
      const result = await deleteMcpKey(tgInitData, keyHash);
      if (result.success) {
        const updated = await fetchMcpKeys(tgInitData);
        setKeys(updated);
      } else {
        setError(result.error ?? 'Не удалось удалить ключ');
      }
    } catch {
      setError('Не удалось удалить ключ');
    }
  }, [tgInitData]);

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

            {initialLoading ? (
              /* Skeleton loader — matches McpKeyItem dimensions */
              <div className="flex flex-col gap-2 w-full">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="relative w-full px-3 py-3 animate-pulse"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      borderRadius: 6,
                      border: '1px solid var(--color-line)',
                      clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <div
                        className="h-4 w-3/4 rounded-sm"
                        style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                      />
                      <div
                        className="h-3 w-1/2 rounded-sm"
                        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                      />
                    </div>
                  </div>
                ))}
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
              <div className="flex flex-col gap-2 w-full">
                {keys.map((keyInfo) => (
                  <McpKeyItem key={keyInfo.keyHash} keyInfo={keyInfo} />
                ))}
              </div>
            )}

          {/* Add key button */}
          <button
            onClick={() => setShowAddSheet(true)}
            disabled={loading}
            className="flex items-center justify-center gap-2 h-10 w-full transition-opacity hover:opacity-90 active:opacity-70 disabled:opacity-50"
            style={{
              clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
              backgroundColor: 'var(--color-accent-amber)',
            }}
            aria-label="Добавить ключ"
          >
            <span
              className="text-[14px] font-semibold"
              style={{ color: 'var(--color-text-white)', fontFamily: 'var(--font-family-display)' }}
            >
              Добавить ключ
            </span>
          </button>
        </div>

        {/* Connection template */}
        <ConnectionTemplate />

        {/* Bottom filler for safe area */}
        <div className="h-16" aria-hidden="true" />
      </div>

      {/* Add key sheet */}
      <AddMcpKeySheet
        open={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        onCreateKey={handleCreateKey}
        workspaces={workspaces}
      />
    </main>
  );
}