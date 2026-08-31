'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Copy, KeyRound, LinkIcon } from 'lucide-react';
import { useTelegramAuth } from '@/hooks/useTelegramAuth';
import { AddMcpKeySheet } from '@/components/settings/AddMcpKeySheet';
import {
  McpKeyDetailSheet,
  cachePlaintextKey,
  getCachedPlaintextKey,
  type McpKeyInfo,
} from '@/components/settings/McpKeyDetailSheet';

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
  agentName: string,
  workspaceId: string,
  expiresInDays: number,
): Promise<CreateKeyResponse> {
  const res = await fetch(
    `/api/mcp-keys?init_data=${encodeURIComponent(initData)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: agentName,
        workspace_id: workspaceId,
        expires_in_days: expiresInDays,
      }),
    },
  );

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

function McpKeyItem({
  keyInfo,
  selected,
  onSelect,
}: {
  keyInfo: McpKeyInfo;
  selected: boolean;
  onSelect: (keyInfo: McpKeyInfo) => void;
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

  const isExpired = new Date(keyInfo.expires_at) < new Date();
  const expiryColor = isExpired ? '#EF4444' : 'var(--color-text-secondary)';

  // Общий стиль углов: срез 8px (верхний левый / нижний правый), скругление 6px (верхний правый / нижний левый)
  const clipPath = 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';
  const borderRadius = '0 6px 0 6px';

  return (
    <div
      className="relative w-full"
      style={{
        clipPath,
        borderRadius,
        // Первый клик выделяет карточку, второй открывает панель.
        // Градиентная рамка — та же, что у выделенной доски на /board
        // (NotchedPanel borderGradient: grad-add-from → grad-add-to, 135deg).
        background: selected
          ? 'linear-gradient(135deg, var(--color-grad-add-from), var(--color-grad-add-to))'
          : 'var(--color-line)',
        padding: selected ? '1.5px' : '1px', // толщина рамки
      }}
    >
      <div
        className="w-full px-3 py-3 transition-opacity hover:opacity-90 active:opacity-70 cursor-pointer"
        style={{
          clipPath,
          borderRadius,
          backgroundColor: 'var(--color-surface)',
        }}
        role="button"
        tabIndex={0}
        aria-label={`Ключ ${keyInfo.name || keyInfo.prefix}`}
        onClick={() => onSelect(keyInfo)}
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

  const clipPath = 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';
  const borderRadius = '0 6px 0 6px';

  return (
    <div
      className="relative w-full"
      style={{
        clipPath,
        borderRadius,
        background: 'var(--color-line)',
        padding: '1px',
        height: '40px', // h-10
      }}
    >
      <button
        onClick={handleClick}
        className="flex items-center justify-center gap-2 w-full h-full transition-opacity hover:opacity-80 active:opacity-60"
        style={{
          clipPath,
          borderRadius,
          backgroundColor: 'var(--color-surface)',
          border: 'none',
          outline: 'none',
          cursor: 'pointer',
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
    </div>
  );
}

function ConnectionTemplate({ selectedKey }: { selectedKey?: McpKeyInfo | null }) {
  const [tab, setTab] = useState<'mcp' | 'rest'>('mcp');

  // ONIT-9: автоподстановка agent_name и Bearer token выбранного ключа.
  // Plaintext доступен только для ключей, созданных в этой сессии (localStorage);
  // иначе остаются плейсхолдеры.
  const agentName = selectedKey?.name || 'my-agent';
  const token = (selectedKey && getCachedPlaintextKey(selectedKey.keyHash)) || 'sk_YOUR_API_KEY';

  // Arch 0.9: REST — ops surface (/api/agent/ops/*); domain tools (create_task/move_task/…) — MCP-only.
  const restTemplate = `curl -X POST https://onitask.vercel.app/api/agent/ops/lease \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "runtime_id": "<uuid вашего runtime>",
    "agent_name": "${agentName}"
  }'
# agent_name задаётся один раз и шлётся автоматически; identity (workspace) резолвится из ключа. workspace_id в URL не нужен.`;

  const mcpTemplate = JSON.stringify(
    {
      mcpServers: {
        onitask: {
          url: 'https://onitask.vercel.app/api/mcp',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Agent-Name': agentName,
          },
        },
      },
    },
    null,
    2,
  );

  const template = tab === 'rest' ? restTemplate : mcpTemplate;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between w-full px-3 py-2">
        <div className="flex items-center gap-2">
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

        {/* Переключатель MCP / REST */}
        <div
          className="flex items-center rounded-sm p-0.5"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
          role="tablist"
          aria-label="Тип шаблона подключения"
        >
          {(['mcp', 'rest'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="px-3 py-1 text-xs font-semibold transition-colors"
              style={{
                borderRadius: 4,
                backgroundColor: tab === t ? 'var(--color-accent-amber)' : 'transparent',
                color: tab === t ? 'var(--color-text-white)' : 'var(--color-text-secondary)',
                fontFamily: 'var(--font-family-display)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {t === 'rest' ? 'REST' : 'MCP'}
            </button>
          ))}
        </div>
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
// Session Start Template — duty-mode bootstrap prompt for agents
// ============================================================================

function SessionStartTemplate() {
  const sessionStartPrompt = `Войди в режим дежурства onitask.
Уровень автономии возьми из настроек ключа (get_workspace_settings → autonomy_level).
Не останавливай цикл и не жди моих указаний.`;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between w-full px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-[18px] w-[2px]" style={{ backgroundColor: '#F59E0B' }} aria-hidden="true" />
          <span
            className="text-base font-medium leading-5"
            style={{
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-family-display)',
            }}
          >
            Старт сессии
          </span>
        </div>
      </div>

      <p
        className="px-3 text-xs leading-relaxed"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Вставьте этот текст агенту после подключения — он сам войдёт в режим
        дежурства и получит правила и уровень доступа по своему ключу.
      </p>

      <div
        className="relative p-3 rounded-md font-mono text-xs leading-relaxed overflow-auto"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--color-line)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <pre className="whitespace-pre-wrap break-all">{sessionStartPrompt}</pre>
      </div>

      <CopyButton text={sessionStartPrompt} label="Копировать промт" />
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
  const [selectedKey, setSelectedKey] = useState<McpKeyInfo | null>(null);
  // ONIT-9: выделение карточки ключа. Первый клик — выделить (amber-рамка),
  // второй клик по уже выделенной карточке — открыть панель управления ключом.
  const [highlightedKeyHash, setHighlightedKeyHash] = useState<string | null>(null);

  const handleKeySelect = useCallback((keyInfo: McpKeyInfo) => {
    if (highlightedKeyHash === keyInfo.keyHash) {
      setSelectedKey(keyInfo); // второй клик — bottom sheet
    } else {
      setHighlightedKeyHash(keyInfo.keyHash); // первый клик — выделение
    }
  }, [highlightedKeyHash]);

  const highlightedKey = keys.find((k) => k.keyHash === highlightedKeyHash) ?? null;

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
