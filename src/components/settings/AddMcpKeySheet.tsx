'use client';

import React, { useState, useCallback } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextInput } from '@/components/ui/desk-ui/TextInput';
import { Button } from '@/components/ui/desk-ui/Button';

// ============================================================================
// Types
// ============================================================================

interface WorkspaceOption {
  id: string;
  name: string;
}

interface ExpiryOption {
  label: string;
  days: number;
}

interface AddMcpKeySheetProps {
  open: boolean;
  onClose: () => void;
  onCreateKey: (name: string, workspaceId: string, expiresInDays: number) => Promise<void>;
  workspaces: WorkspaceOption[];
}

// ============================================================================
// Constants
// ============================================================================

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '1 месяц', days: 30 },
  { label: '3 месяца', days: 90 },
  { label: '6 месяцев', days: 180 },
  { label: '1 год', days: 365 },
];

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Styled select field — NotchedPanel + chevron pattern.
 */
function SelectField({
  label,
  value,
  placeholder,
  hint,
  trailingIcon = true,
  onClick,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  trailingIcon?: boolean;
  onClick: () => void;
}) {
  const displayText = value || placeholder;
  const isPlaceholder = !value;

  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative flex items-center h-10 w-full cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 6,
          border: '1px solid var(--color-line)',
          clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
        }}
        onClick={onClick}
        role="button"
        tabIndex={0}
        aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      >
        <span
          className="text-base tracking-tighter truncate px-3"
          style={{
            color: isPlaceholder ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-display)',
          }}
        >
          {displayText}
        </span>
        {trailingIcon && (
          <ChevronDown
            className="w-5 h-5 shrink-0 mr-3"
            style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}
          />
        )}
      </div>
      {hint && (
        <span
          className="text-xs"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Workspace picker sheet — nested bottom sheet for selecting a workspace.
 */
function WorkspacePickerSheet({
  open,
  onClose,
  workspaces,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: WorkspaceOption[];
  onSelect: (ws: WorkspaceOption) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-2 pb-6">
        <h3
          className="text-xl font-semibold px-4 pt-2 pb-4"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-family-display)' }}
        >
          Выберите доску
        </h3>
        {workspaces.length === 0 ? (
          <p
            className="text-sm px-4"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Нет доступных досок
          </p>
        ) : (
          workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => { onSelect(ws); onClose(); }}
              className="flex items-center h-12 w-full text-left transition-opacity hover:opacity-80 active:opacity-60"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 6,
                border: '1px solid var(--color-line)',
                clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
              }}
            >
              <span
                className="text-base tracking-tighter px-4"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-family-display)',
                }}
              >
                {ws.name}
              </span>
            </button>
          ))
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * Expiry picker sheet — nested bottom sheet for selecting key expiry.
 */
function ExpiryPickerSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (days: number) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-2 pb-6">
        <h3
          className="text-xl font-semibold px-4 pt-2 pb-4"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-family-display)' }}
        >
          Срок работы ключа
        </h3>
        {EXPIRY_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            onClick={() => { onSelect(opt.days); onClose(); }}
            className="flex items-center h-12 w-full text-left transition-opacity hover:opacity-80 active:opacity-60"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 6,
              border: '1px solid var(--color-line)',
              clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
            }}
          >
            <span
              className="text-base tracking-tighter px-4"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-family-display)',
              }}
            >
              {opt.label}
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AddMcpKeySheet({
  open,
  onClose,
  onCreateKey,
  workspaces,
}: AddMcpKeySheetProps) {
  const [name, setName] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceOption | null>(null);
  const [selectedExpiryDays, setSelectedExpiryDays] = useState<number>(90);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = selectedWorkspace !== null && name.trim().length > 0;

  const handleCreate = useCallback(async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      await onCreateKey(name.trim(), selectedWorkspace!.id, selectedExpiryDays);
      // Reset form
      setName('');
      setSelectedWorkspace(null);
      setSelectedExpiryDays(90);
      onClose();
    } finally {
      setLoading(false);
    }
  }, [canSubmit, loading, name, selectedWorkspace, selectedExpiryDays, onCreateKey, onClose]);

  return (
    <>
      {/* Main add key sheet */}
      <BottomSheet open={open} onClose={onClose}>
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
              Новый ключ MCP
            </h3>
          </div>

          {/* Board selector */}
          <div className="flex flex-col gap-1">
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Доска
            </span>
            <SelectField
              label="Доска"
              value={selectedWorkspace?.name ?? ''}
              placeholder="Выберите доску"
              hint="Выберите доску к которой будет подключен агент"
              onClick={() => setShowWorkspacePicker(true)}
            />
          </div>

          {/* Display name input */}
          <div className="flex flex-col gap-1">
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Отображаемое название
            </span>
            <TextInput
              corner="field"
              placeholder="Введите название ключа"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>

          {/* Expiry selector */}
          <div className="flex flex-col gap-1">
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Срок работы ключа
            </span>
            <SelectField
              label="Срок работы ключа"
              value={EXPIRY_OPTIONS.find((o) => o.days === selectedExpiryDays)?.label ?? ''}
              placeholder="Месяц"
              onClick={() => setShowExpiryPicker(true)}
            />
          </div>

          {/* Create button */}
          <Button
            variant="solid"
            corner="action"
            disabled={!canSubmit || loading}
            onClick={handleCreate}
            className="w-full"
          >
            {loading ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </BottomSheet>

      {/* Nested pickers */}
      <WorkspacePickerSheet
        open={showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        workspaces={workspaces}
        onSelect={setSelectedWorkspace}
      />
      <ExpiryPickerSheet
        open={showExpiryPicker}
        onClose={() => setShowExpiryPicker(false)}
        onSelect={setSelectedExpiryDays}
      />
    </>
  );
}