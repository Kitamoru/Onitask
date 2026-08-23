'use client';

import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/desk-ui/Button';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';

// ============================================================================
// Types
// ============================================================================

export interface McpKeyInfo {
  keyHash: string;
  name: string;
  created_at: string;
  expires_at: string;
  prefix: string;
  workspace_id: string;
  workspace_name: string;
}

interface McpKeyDetailSheetProps {
  open: boolean;
  onClose: () => void;
  keyInfo: McpKeyInfo | null;
  onDelete: (keyHash: string) => Promise<void>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Plaintext keys are never stored server-side (contract v0.8.0 §2.3).
 * At creation time the page caches them in localStorage so the user can
 * copy the key later from this sheet. If absent — copy is unavailable.
 */
export function getCachedPlaintextKey(keyHash: string): string | null {
  try {
    const raw = window.localStorage.getItem('mcp_key_plaintexts');
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[keyHash] ?? null;
  } catch {
    return null;
  }
}

export function cachePlaintextKey(keyHash: string, plaintext: string): void {
  try {
    const raw = window.localStorage.getItem('mcp_key_plaintexts');
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[keyHash] = plaintext;
    window.localStorage.setItem('mcp_key_plaintexts', JSON.stringify(map));
  } catch {
    /* non-critical */
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Sub-components
// ============================================================================

/** Read-only field styled like the create-sheet inputs. */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <span className="text-[15px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </span>
      <NotchedPanel
        corner="field"
        notch={8}
        contentClassName="flex items-center h-10 w-full px-3"
      >
        <span
          className="text-base tracking-tighter truncate"
          style={{
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-family-display)',
          }}
        >
          {value || '—'}
        </span>
      </NotchedPanel>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function McpKeyDetailSheet({
  open,
  onClose,
  keyInfo,
  onDelete,
}: McpKeyDetailSheetProps) {
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const plaintext = keyInfo ? getCachedPlaintextKey(keyInfo.keyHash) : null;

  const handleCopy = useCallback(async () => {
    if (!keyInfo) return;
    const ok = await copyText(plaintext ?? '');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [keyInfo, plaintext]);

  const handleDelete = useCallback(async () => {
    if (!keyInfo || deleting) return;
    setDeleting(true);
    try {
      await onDelete(keyInfo.keyHash);
      // Remove cached plaintext — key no longer exists
      try {
        const raw = window.localStorage.getItem('mcp_key_plaintexts');
        if (raw) {
          const map = JSON.parse(raw) as Record<string, string>;
          delete map[keyInfo.keyHash];
          window.localStorage.setItem('mcp_key_plaintexts', JSON.stringify(map));
        }
      } catch {
        /* non-critical */
      }
      setShowDeleteConfirm(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  }, [keyInfo, deleting, onDelete, onClose]);

  const deleteConfirmModal =
    showDeleteConfirm &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-4"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        onClick={() => {
          if (!deleting) setShowDeleteConfirm(false);
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-key-title"
      >
        <div
          className="w-full max-w-sm rounded-2xl p-6"
          style={{ backgroundColor: '#1A1A1A' }}
          onClick={(e) => e.stopPropagation()}
        >
          <p
            id="delete-key-title"
            className="mb-2 text-center text-lg font-semibold"
            style={{ color: '#FAFAFA' }}
          >
            Удалить ключ?
          </p>
          <p className="mb-6 text-center text-sm" style={{ color: '#8B8B8B' }}>
            Агенты, использующие этот ключ, потеряют доступ к доске.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              variant="solid"
              onClick={handleDelete}
              disabled={deleting}
              fill="#EF4444"
              textColor="#FAFAFA"
            >
              {deleting ? 'Удаление...' : 'Удалить ключ'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              style={{ borderColor: '#333', color: '#8B8B8B' }}
            >
              Отмена
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <BottomSheet open={open && !!keyInfo} onClose={onClose}>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* Header */}
          <div className="flex items-center justify-between pt-2 pb-2">
            <h3
              className="text-xl font-semibold"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-display)',
              }}
            >
              Ключ MCP
            </h3>
          </div>

          {/* Fields — filled and read-only */}
          <ReadOnlyField label="Доска" value={keyInfo?.workspace_name ?? ''} />
          <ReadOnlyField label="Отображаемое название" value={keyInfo?.name ?? ''} />
          <ReadOnlyField label="Действует до" value={keyInfo ? formatDate(keyInfo.expires_at) : ''} />

          {!plaintext && (
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Полный ключ показывается только один раз — при создании.
            </span>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-1">
            <Button
              variant="solid"
              corner="action"
              disabled={!plaintext}
              onClick={handleCopy}
              className="w-full"
            >
              {copied ? 'Скопировано ✓' : 'Скопировать'}
            </Button>
            <Button
              variant="outline"
              corner="action"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full"
              fill="transparent"
              textColor="#EF4444"
              style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#EF4444' }}
            >
              Удалить
            </Button>
          </div>
        </div>
      </BottomSheet>

      {/* Delete confirmation — portal above BottomSheet transform context */}
      {deleteConfirmModal}
    </>
  );
}