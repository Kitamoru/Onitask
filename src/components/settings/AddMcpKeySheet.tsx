'use client';

import React, { useState, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TextInput } from '@/components/ui/desk-ui/TextInput';
import { Button } from '@/components/ui/desk-ui/Button';
import { NotchedPanel } from '@/components/ui/desk-ui/NotchedPanel';

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
  onCreateKey: (
    name: string,
    workspaceId: string,
    expiresInDays: number,
    autonomyLevel: string,
  ) => Promise<void>;
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

interface AutonomyOption {
  level: string;
  label: string;
  hint: string;
}

const AUTONOMY_OPTIONS: AutonomyOption[] = [
  {
    level: 'observer',
    label: 'Наблюдатель',
    hint: 'Только чтение: следит за задачами и сообщает о новых',
  },
  {
    level: 'tasks',
    label: 'Исполнитель',
    hint: 'Сам берёт задачи в работу и доводит до ревью',
  },
  {
    level: 'full',
    label: 'Полный',
    hint: 'Задачи + деплой кода после апрува на ревью (git push)',
  },
];

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Styled select field using NotchedPanel — matches TextInput style.
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
    <div className="flex flex-col gap-1 w-full">
      <div
        className="cursor-pointer transition-opacity hover:opacity-80 active:opacity-60 w-full"
        onClick={onClick}
        role="button"
        tabIndex={0}
        aria-label={label}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      >
        <NotchedPanel
          corner="field"
          notch={8}
          contentClassName="flex items-center justify-center h-10 w-full px-3"
        >
          <span
            className="text-base tracking-tighter truncate text-center"
            style={{
              color: isPlaceholder ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
              fontFamily: 'var(--font-family-display)',
            }}
          >
            {displayText}
          </span>
          {trailingIcon && (
            <ChevronDown
              className="w-5 h-5 shrink-0 ml-2"
              style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}
            />
          )}
        </NotchedPanel>
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
 * Picker option button using NotchedPanel — matches TextInput style.
 */
function PickerOptionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      className="cursor-pointer transition-opacity hover:opacity-80 active:opacity-60 w-full"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <NotchedPanel
        corner="field"
        notch={8}
        contentClassName="h-12 w-full flex items-center justify-center"
      >
        <span
          className="text-base tracking-tighter text-center"
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-display)',
          }}
        >
          {label}
        </span>
      </NotchedPanel>
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
      <div className="flex flex-col gap-2 pb-6 max-w-md mx-auto">
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
            <PickerOptionButton
              key={ws.id}
              label={ws.name}
              onClick={() => { onSelect(ws); onClose(); }}
            />
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
      <div className="flex flex-col gap-2 pb-6 max-w-md mx-auto">
        <h3
          className="text-xl font-semibold px-4 pt-2 pb-4"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-family-display)' }}
        >
          Срок работы ключа
        </h3>
        {EXPIRY_OPTIONS.map((opt) => (
          <PickerOptionButton
            key={opt.days}
            label={opt.label}
            onClick={() => { onSelect(opt.days); onClose(); }}
          />
        ))}
      </div>
    </BottomSheet>
  );
}

/**
 * Autonomy picker sheet — nested bottom sheet for selecting duty-mode tier.
 */
function AutonomyPickerSheet({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (level: string) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-2 pb-6 max-w-md mx-auto">
        <h3
          className="text-xl font-semibold px-4 pt-2 pb-4"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-family-display)' }}
        >
          Уровень автономии
        </h3>
        {AUTONOMY_OPTIONS.map((opt) => (
          <div
            key={opt.level}
            className="cursor-pointer transition-opacity hover:opacity-80 active:opacity-60 w-full"
            onClick={() => { onSelect(opt.level); onClose(); }}
            role="button"
            tabIndex={0}
          >
            <NotchedPanel
              corner="field"
              notch={8}
              contentClassName="flex flex-col items-center gap-0.5 py-3 px-4 w-full"
            >
              <span
                className="text-base tracking-tighter text-center"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-family-display)',
                }}
              >
                {opt.label}
              </span>
              <span
                className="text-xs text-center"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {opt.hint}
              </span>
            </NotchedPanel>
          </div>
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
  const [selectedLevel, setSelectedLevel] = useState<string>('tasks');
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);
  const [showAutonomyPicker, setShowAutonomyPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = selectedWorkspace !== null && name.trim().length > 0;

  const handleCreate = useCallback(async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      await onCreateKey(name.trim(), selectedWorkspace!.id, selectedExpiryDays, selectedLevel);
      // Reset form
      setName('');
      setSelectedWorkspace(null);
      setSelectedExpiryDays(90);
      setSelectedLevel('tasks');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [canSubmit, loading, name, selectedWorkspace, selectedExpiryDays, selectedLevel, onCreateKey, onClose]);

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

          {/* Autonomy level selector */}
          <div className="flex flex-col gap-1">
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Уровень автономии
            </span>
            <SelectField
              label="Уровень автономии"
              value={AUTONOMY_OPTIONS.find((o) => o.level === selectedLevel)?.label ?? ''}
              placeholder="Исполнитель"
              hint="Определяет, что агенту разрешено делать в режиме дежурства"
              onClick={() => setShowAutonomyPicker(true)}
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
      <AutonomyPickerSheet
        open={showAutonomyPicker}
        onClose={() => setShowAutonomyPicker(false)}
        onSelect={setSelectedLevel}
      />
    </>
  );
}