'use client';

/**
 * InviteModal — BottomSheet for creating and sharing invite links.
 *
 * WS-06: Admin/Owner clicks "Добавить коллегу" → modal opens →
 * GET /api/workspaces/[id]/invite → existing link shown (if any) →
 * POST /api/workspaces/[id]/invite → new link created → copy to clipboard.
 *
 * Design System:
 * - BottomSheet (portal, slide-up, var(--color-surface))
 * - Button (variant="solid" for copy/create, variant="outline" for close)
 * - TextInput (read-only for link display)
 * - var() tokens for colors, Tailwind for layout
 */

import { useState, useCallback, useEffect } from 'react';
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

  // Load existing active invite link when modal opens
  useEffect(() => {
    if (!open || !workspaceId || !initData) return;

    setLoading(true);
    setError(null);

    fetch(`/api/workspaces/${workspaceId}/invite?init_data=${encodeURIComponent(initData)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data.url) {
          setInviteUrl(data.data.url);
        } else {
          setInviteUrl(null);
        }
      })
      .catch(() => {
        setInviteUrl(null);
      })
      .finally(() => setLoading(false));
  }, [open, workspaceId, initData]);

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

        {/* Actions — buttons above, instructions below (like sprint sheet) */}
        <div className="flex gap-3 mb-6">
          {/* If link exists — show Copy + Create new */}
          {inviteUrl ? (
            <>
              <Button
                variant="solid"
                onClick={handleCopy}
                aria-label="Скопировать ссылку"
                type="button"
              >
                {copied ? '✓ Скопировано' : 'Скопировать'}
              </Button>
              <Button
                variant="outline"
                onClick={handleCreateLink}
                disabled={loading}
                aria-label="Создать новую ссылку"
                type="button"
              >
                {loading ? 'Создание...' : 'Создать новую'}
              </Button>
            </>
          ) : (
            /* No link — show Create only */
            <Button
              variant="solid"
              onClick={handleCreateLink}
              disabled={loading || !workspaceId}
              aria-label="Создать ссылку"
              type="button"
            >
              {loading ? 'Создание...' : 'Создать ссылку'}
            </Button>
          )}

        </div>

        {/* Instructions — at the bottom, centered, like sprint sheet */}
        <p
          className="text-sm text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Скопируйте ссылку или создайте новую.
          Ссылка действительна 24 часа, до 10 использований.
        </p>
      </div>
    </BottomSheet>
  );
}