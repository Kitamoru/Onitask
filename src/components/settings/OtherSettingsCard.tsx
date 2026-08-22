'use client';

import { Send } from 'lucide-react';
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
        <SettingsRow
          label="Техподдержка"
          value="Написать"
          onClick={onSupportClick}
          trailingIcon={<Send className="w-5 h-5 shrink-0" />}
        />
      </div>
    </div>
  );
}