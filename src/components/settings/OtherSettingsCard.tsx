'use client';

import { ChevronRight } from 'lucide-react';

/**
 * SectionHeading — заголовок секции с жёлтой линией слева.
 */
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 w-full px-3 py-[14px]">
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
 * SettingsRow — строка настроек с текстом и иконкой справа.
 * Figma: template EL-c7474eb0 (status/lang/support rows)
 */
function SettingsRow({
  label,
  value,
  trailingIcon,
  onClick,
}: {
  label: string;
  value: string;
  trailingIcon?: React.ReactNode;
  onClick?: () => void;
}) {
  const Interactive = onClick ? 'button' : 'div';
  return (
    <Interactive
      className="flex items-center justify-between w-full px-3 py-[14px] rounded cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 6,
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
      {/* Left decorative line */}
      <div
        className="h-[18px] w-[2px]"
        style={{ backgroundColor: '#F59E0B' }}
        aria-hidden="true"
      />
      <span
        className="text-base font-medium leading-5 text-amber"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {label}
      </span>
      <span
        className="text-base font-medium leading-5 text-white"
        style={{
          fontFamily: 'var(--font-family-display)',
          fontWeight: 'var(--font-weight-medium)',
        }}
      >
        {value}
      </span>
      {trailingIcon ?? <ChevronRight className="h-5 w-5 text-text-secondary shrink-0" />}
    </Interactive>
  );
}

/**
 * OtherSettingsCard — секция "other".
 * Содержит heading "Прочее", язык и техподдержку.
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
          <SettingsRow
            label="Язык"
            value={language}
            onClick={onLanguageClick}
          />
        )}
        <SettingsRow
          label="Техподдержка"
          value="Написать"
          onClick={onSupportClick}
        />
      </div>
    </div>
  );
}