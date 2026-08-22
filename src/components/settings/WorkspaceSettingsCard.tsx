'use client';

import { SettingsRow } from './SettingsRow';

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
    <div className="flex flex-col gap-3 w-full bg-surface rounded-[8px] p-3">
      <SectionHeading title="Рабочее пространство" />
      <div className="flex flex-col gap-3 w-full">
        <SettingsRow label="MCP" onClick={onMcpClick} />
        <SettingsRow label="Тарифы" onClick={onPlansClick} />
        <SettingsRow label="Коллеги" onClick={onColleaguesClick} />
      </div>
    </div>
  );
}