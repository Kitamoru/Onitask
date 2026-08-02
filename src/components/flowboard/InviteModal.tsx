'use client';

/**
 * InviteModal — BottomSheet for creating and sharing invite links.
 *
 * WS-06: Admin/Owner clicks "Добавить коллегу" → modal opens →
 * POST /api/workspaces/[id]/invite → link displayed → copy to clipboard.
 *
 * Design System:
 * - BottomSheet (portal, slide-up, var(--color-surface))
 * - Button (variant="primary" for copy, variant="outline" for close)
 * - TextInput (read-only for link display)
 * - var() tokens for colors, Tailwind for layout
 */

import { useState, useCallback } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/desk-ui/Button';
import { TextInput } from '../ui/desk-ui/TextInput';

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  initData: string | undefined;
}

export function InviteModal({ open, onClose, workspaceId, initData }: InviteModalProps) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreateLink = useCallback(async () => {
    if (!workspaceId || !initData) return;

    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ init_data: initData }),
      });

      const data = await res.json();

      if (!data.success) {
        if (data.error === 'only_admin_can_invite') {
          setError('Только администратор может создавать ссылки');
        } else if (data.error === 'forbidden') {
          setError('Нет доступа к этому workspace');
        } else {
          setError('Не удалось создать ссылку');
        }
        setInviteUrl(null);
      } else {
        setInviteUrl(data.data.url);
      }
    } catch {
      setError('Ошибка сети');
      setInviteUrl(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, initData]);

  const handleCopy = useCallback(async () => {
    if (!inviteUrl) return;

    // Try Telegram WebApp API first, fallback to navigator.clipboard
    const tg = (window as unknown as { Telegram?: { WebApp?: { copyToClipboard?: (text: string) => void } } }).Telegram?.WebApp;
    if (tg?.copyToClipboard) {
      tg.copyToClipboard(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback: select text in input for manual copy
      }
    }
  }, [inviteUrl]);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-4 pb-6 pt-2">
        {/* Title */}
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Пригласить коллегу
        </h2>

        {/* Description */}
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Создайте ссылку и отправьте её коллегам в Telegram.
          Ссылка действительна 24 часа, до 10 использований.
        </p>

        {/* Error state */}
        {error && (
          <div
            className="rounded-lg p-3 mb-4 text-sm"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: 'var(--color-signal-red)',
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Link display */}
        {inviteUrl && (
          <div className="mb-4">
            <TextInput
              value={inviteUrl}
              readOnly
              aria-label="Ссылка для приглашения"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {!inviteUrl ? (
            <Button
              variant="solid"
              onClick={handleCreateLink}
              disabled={loading || !workspaceId}
              aria-label="Создать ссылку"
              type="button"
            >
              {loading ? 'Создание...' : 'Создать ссылку'}
            </Button>
          ) : (
            <Button
              variant="solid"
              onClick={handleCopy}
              aria-label="Скопировать ссылку"
              type="button"
            >
              {copied ? '✓ Скопировано' : 'Скопировать'}
            </Button>
          )}

          <Button
            variant="outline"
            onClick={onClose}
            aria-label="Закрыть"
            type="button"
          >
            Закрыть
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}