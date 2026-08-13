'use client';

import { ChevronRight } from 'lucide-react';

/**
 * SectionHeading — заголовок секции с жёлтой линией слева.
 * Figma: frame "heading" #414:33059 / #414:33065
 */
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 w-full px-3 py-[14px]">
      {/* Yellow accent line */}
      <div
        className="h-[18px] w-[2px]"
        style={{ backgroundColor: '#F59E0B' }}
        aria-hidden="true"
      />
      <span
        className="text-sm font-medium leading-[18px] text-white"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {title}
      </span>
    </div>
  );
}

/**
 * SettingsRow — строка настроек с текстом и chevron.
 * Figma: template EL-15e74083 (frame with padding 12px)
 */
function SettingsRow({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  const Interactive = onClick ? 'button' : 'div';
  return (
    <Interactive
      className="flex items-center justify-between w-full px-3 py-3 rounded cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 4,
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
        className="text-sm font-medium leading-[18px] text-white"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {label}
      </span>
      <ChevronRight className="h-5 w-5 text-text-secondary shrink-0" />
    </Interactive>
  );
}

/**
 * WorkspaceSettingsCard — секция "workspace-settings".
 * Содержит heading "Рабочее пространство" и кнопки: MCP, Тарифы, Коллеги.
 * Figma: frame "workspace-settings" #375:30389
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
      <div className="flex flex-col gap-2 w-full">
        <SettingsRow label="Интеграции MCP" onClick={onMcpClick} />
        <SettingsRow label="Тарифы" onClick={onPlansClick} />
        <SettingsRow label="Мои коллеги" onClick={onColleaguesClick} />
      </div>
    </div>
  );
}