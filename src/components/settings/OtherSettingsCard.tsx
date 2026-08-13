'use client';

import { ChevronRight } from 'lucide-react';

/**
 * SettingsRow — строка настроек с текстом слева и чевроном справа.
 * Без жёлтой полоски, просто label + value + chevron.
 * Серый бордер + chamfered corners (top-left + bottom-right).
 */
function SettingsRow({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
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
      aria-label={`${label}: ${value}`}
    >
      <span
        className="text-base font-medium leading-5 text-white"
        style={{ fontFamily: 'var(--font-family-display)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className="text-base font-medium leading-5 text-white"
          style={{ fontFamily: 'var(--font-family-display)' }}
        >
          {value}
        </span>
        <ChevronRight className="h-5 w-5 text-text-secondary shrink-0" />
      </div>
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
 * OtherSettingsCard — секция "other".
 * Содержит heading "Прочее", язык и техподдержка.
 * Figma: frame "other" #375:30468
 */
export function OtherSettingsCard({
  language,
  onLanguageClick,
  onSupportClick,
}: {
  language?: string;
  onLanguageClick?: () => void;
  onSupportClick?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 w-full">
      <SectionHeading title="Прочее" />
      <div className="flex flex-col gap-3 w-full">
        {language && (
          <SettingsRow label="Язык" value={language} onClick={onLanguageClick} />
        )}
        <SettingsRow label="Техподдержка" value="Написать" onClick={onSupportClick} />
      </div>
    </div>
  );
}