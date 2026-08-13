'use client';

import { ChevronRight } from 'lucide-react';

/**
 * SettingsRow — строка настроек с текстом слева и чевроном справа.
 * Серый бордер + chamfered corners (top-left + bottom-right).
 */
function SettingsRow({ label, onClick }: { label: string; onClick?: () => void }) {
  const Interactive = onClick ? 'button' : 'div';
  return (
    <Interactive
      className="flex items-center justify-between w-full px-3 py-[14px] cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
        border: '1px solid var(--color-line)',
        // Chamfered corners: top-left + bottom-right (action style)
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={label}
    >
      <span
        className="text-base font-medium leading-5 text-white"
        style={{ fontFamily: 'var(--font-family-display)' }}
      >
        {label}
      </span>
      <ChevronRight className="h-5 w-5 text-text-secondary shrink-0" />
    </Interactive>
  );
}

/**
 * SectionHeading — заголовок секции с жёлтой линией.
 * Размер шрифта как у "Статус" — text-base (16px).
 */
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 w-full px-3 py-[14px]">
      <div className="h-[18px] w-[2px]" style={{ backgroundColor: '#F59E0B' }} aria-hidden="true" />
      <span
        className="text-base font-medium leading-5 text-white"
        style={{ fontFamily: 'var(--font-family-display)' }}
      >
        {title}
      </span>
    </div>
  );
}

/**
 * WorkspaceSettingsCard — секция workspace settings.
 * Figma: frame "workspace-settings" #375:30461
 */
export function WorkspaceSettingsCard({
  onMcpClick,
  onPlansClick,
  onColleaguesClick,
}: {
  onMcpClick?: () => void;
  onPlansClick?: () => void;
  onColleaguesClick?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 w-full">
      <SectionHeading title="Рабочее пространство" />
      <div className="flex flex-col gap-3 w-full">
        <SettingsRow label="MCP" onClick={onMcpClick} />
        <SettingsRow label="Тарифы" onClick={onPlansClick} />
        <SettingsRow label="Коллеги" onClick={onColleaguesClick} />
      </div>
    </div>
  );
}