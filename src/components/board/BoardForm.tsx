'use client';

import React, { useState } from 'react';
import { BoardHeader } from './Header';
import { TextInput } from './TextInput';
import { Toggle } from './Toggle';
import { Counter } from './Counter';
import { BadgeList, type Colleague } from './BadgeList';
import { TextArea } from './TextArea';
import { FilePicker } from './FilePicker';
import { LinkInputGroup } from './LinkInputGroup';
import { SubmitButton } from './SubmitButton';

/**
 * BoardForm — Complete "Create Board" form matching Figma design (node 1:913).
 * 
 * Layout structure:
 *   - Dark background (#0A0A0A)
 *   - Scrollable vertical column (overflow-y)
 *   - Sections separated by 24px gap
 *   - Max width: 358px (mobile-first)
 *   - Primary submit button at bottom
 *   - Bottom filler (64px) for safe area
 */
export interface BoardFormData {
  name: string;
  slug: string;
  storyPoints: {
    enabled: boolean;
    values: [number, number, number, number, number]; // [1, 3, 5, 7, 13]
  };
  cognitiveWeight: {
    enabled: boolean;
    description: string;
  };
  colleagues: Colleague[];
  context: string;
  documents: File[];
  externalLinks: Array<{ name: string; url: string }>;
  signals: {
    enabled: boolean;
    values: Array<{ value: number; label: string }>;
  };
}

export interface BoardFormProps {
  /** Initial form data */
  initialData?: Partial<BoardFormData>;
  /** Submit handler */
  onSubmit: (data: BoardFormData) => void | Promise<void>;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string;
}

const DEFAULT_SP_VALUES: [number, number, number, number, number] = [1, 3, 5, 7, 13];

/** Gradient border style matching Figma input-field-s component (7:8090) */
const SP_INPUT_GRADIENT_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
  borderRadius: '4px',
  mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  maskComposite: 'exclude',
  WebkitMaskComposite: 'xor',
  padding: '1px',
};

const DEFAULT_SIGNALS = [
  { value: 1, label: '1 день' },
  { value: 3, label: '3 дня' },
];

export function BoardForm({
  initialData = {},
  onSubmit,
  loading = false,
  error: globalError,
}: BoardFormProps) {
  // Board name section
  const [name, setName] = useState(initialData.name || '');
  const [slug, setSlug] = useState(initialData.slug || '');

  // Functional settings
  const [spEnabled, setSpEnabled] = useState(initialData.storyPoints?.enabled ?? false);
  const [spValues, setSpValues] = useState<[number, number, number, number, number]>(
    initialData.storyPoints?.values || DEFAULT_SP_VALUES
  );

  // CW toggle defaults to true per Figma spec (node 337:28043 is-active=true)
  const [cwEnabled, setCwEnabled] = useState(initialData.cognitiveWeight?.enabled ?? true);
  const [cwDescription, setCwDescription] = useState(
    initialData.cognitiveWeight?.description || ''
  );

  // Colleagues
  const [colleagues, setColleagues] = useState<Colleague[]>(
    initialData.colleagues || []
  );

  // Context
  const [context, setContext] = useState(initialData.context || '');

  // Documents
  const [documents, setDocuments] = useState<File[]>(initialData.documents || []);

  // External links
  const [links, setLinks] = useState<Array<{ name: string; url: string }>>(
    initialData.externalLinks || []
  );
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  // Signals
  const [signalsEnabled, setSignalsEnabled] = useState(
    initialData.signals?.enabled ?? false
  );
  const [signalValues, setSignalValues] = useState(
    initialData.signals?.values || DEFAULT_SIGNALS
  );

  const handleAddColleague = () => {
    // Placeholder: open colleague picker modal
    console.log('Add colleague clicked');
  };

  const handleAddLink = () => {
    if (linkName.trim() && linkUrl.trim()) {
      setLinks([...links, { name: linkName.trim(), url: linkUrl.trim() }]);
      setLinkName('');
      setLinkUrl('');
    }
  };

  const handleSignalChange = (index: number, value: number) => {
    setSignalValues((prev) =>
      prev.map((s, i) => (i === index ? { ...s, value } : s))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const formData: BoardFormData = {
      name,
      slug,
      storyPoints: { enabled: spEnabled, values: spValues },
      cognitiveWeight: { enabled: cwEnabled, description: cwDescription },
      colleagues,
      context,
      documents,
      externalLinks: links,
      signals: { enabled: signalsEnabled, values: signalValues },
    };

    await onSubmit(formData);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col w-full max-w-[358px] mx-auto overflow-y-auto bg-primary-dark"
      style={{ padding: '16px', gap: '24px' }}
      noValidate
    >
      {/* Global error */}
      {globalError && (
        <div
          className="px-4 py-2 rounded-md text-sm"
          style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#F59E0B' }}
          role="alert"
        >
          {globalError}
        </div>
      )}

      {/* ===== Section: Основное ===== */}
      <Section>
        <BoardHeader title="Основное" />
        <div className="mt-4 space-y-3">
          <TextInput
            id="board-name"
            placeholder="Название доски"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="md"
            aria-label="Название доски"
          />
          <TextInput
            id="board-slug"
            placeholder="@desk"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            size="md"
            aria-label="Идентификатор доски"
          />
        </div>
      </Section>

      {/* ===== Section: Функциональное ===== */}
      <Section>
        <BoardHeader title="Функциональное" />

        {/* Story Points Toggle */}
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              padding: '1px',
            }}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-bg-light"
                style={{
                  fontFamily: "'Inter Display', system-ui, sans-serif",
                  fontSize: '16px',
                  lineHeight: '20px',
                  fontWeight: '500',
                  letterSpacing: '-0.0313em',
                }}
              >
                Стоимость сторипоинта
              </span>
              <Toggle
                checked={spEnabled}
                onChange={setSpEnabled}
                aria-label="Включить story points"
              />
            </div>

            {/* SP value inputs — gradient border per Figma input-field-s (7:8090) */}
            {spEnabled && (
              <div className="space-y-1.5">
                {['1 SP', '3 SP', '5 SP', '7 SP', '13 SP'].map((label, index) => (
                  <div key={label} className="flex items-center gap-2">
                    <span
                      className="text-bg-light shrink-0"
                      style={{
                        fontFamily: "'Inter Display', system-ui, sans-serif",
                        fontSize: '14px',
                        lineHeight: '18px',
                        fontWeight: '500',
                        width: '40px',
                      }}
                    >
                      {label}
                    </span>
                    <div className="relative flex-1">
                      {/* Gradient background shape (Figma input-field-s border) */}
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={SP_INPUT_GRADIENT_STYLE}
                        aria-hidden="true"
                      />
                      <div className="flex items-center w-full" style={{ padding: '10px 12px' }}>
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={spValues[index]}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 0;
                            const newValues = [...spValues] as typeof spValues;
                            newValues[index] = val;
                            setSpValues(newValues);
                          }}
                          disabled={!spEnabled}
                          className="
                            flex-1 min-w-0 bg-transparent text-bg-light outline-none
                            disabled:opacity-50
                            focus-visible:ring-2 focus-visible:ring-accent-amber
                            [-moz-appearance:textfield]
                            [&::-webkit-outer-spin-button]:appearance-none
                            [&::-webkit-inner-spin-button]:appearance-none
                          "
                          style={{
                            fontFamily: "'Inter', system-ui, sans-serif",
                            fontSize: '14px',
                            lineHeight: '20px',
                            letterSpacing: '-0.0357em',
                            fontWeight: '500',
                          }}
                          aria-label={`Story point значение для ${label}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cognitive Weight Toggle */}
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              padding: '1px',
            }}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-bg-light"
                style={{
                  fontFamily: "'Inter Display', system-ui, sans-serif",
                  fontSize: '16px',
                  lineHeight: '20px',
                  fontWeight: '500',
                  letterSpacing: '-0.0313em',
                }}
              >
                Когнитивный вес
              </span>
              <Toggle
                checked={cwEnabled}
                onChange={setCwEnabled}
                aria-label="Включить когнитивный вес"
              />
            </div>

            {/* Description text */}
            {cwEnabled && (
              <p
                className="text-text-muted mb-3"
                style={{
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontSize: '12px',
                  lineHeight: '16px',
                  letterSpacing: '-0.0417em',
                  fontWeight: '400',
                }}
              >
                Текст описание функционала когнитивного веса задачи, который расписан в 2-3 строчки, чтобы пользователь понимал, что оно из себя представляет
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ===== Section: Коворкинг ===== */}
      <Section>
        <BoardHeader title="Коворкинг" />
        <div className="mt-4">
          <BadgeList
            colleagues={colleagues}
            onAddColleagues={handleAddColleague}
          />
        </div>
      </Section>

      {/* ===== Section: Контекст доски ===== */}
      <Section>
        <BoardHeader title="Контекст доски" />
        <div className="mt-4">
          <TextArea
            placeholder="Краткое описание"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            aria-label="Контекст доски"
          />
        </div>
      </Section>

      {/* ===== Section: Дополнительные материалы ===== */}
      <Section>
        <BoardHeader title="Дополнительные материалы" />
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              padding: '1px',
            }}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Docs header */}
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-bg-light"
                style={{
                  fontFamily: "'Inter Display', system-ui, sans-serif",
                  fontSize: '16px',
                  lineHeight: '20px',
                  fontWeight: '500',
                  letterSpacing: '-0.0313em',
                }}
              >
                Документы
              </span>
              <Toggle
                checked={documents.length > 0}
                onChange={() => {}}
                aria-label="Включить документы"
              />
            </div>

            {/* File picker */}
            <div className="mb-2">
              <FilePicker
                file={documents[0] || null}
                onChange={(file) => {
                  if (file) {
                    setDocuments([file]);
                  }
                }}
              />
            </div>

            {/* Add .md file button */}
            <button
              type="button"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.md';
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) setDocuments([...documents, f]);
                };
                input.click();
              }}
              className="
                flex items-center justify-center w-full h-10
                rounded-md
                bg-surface/50
                border border-white/10
                text-bg-light
                font-semibold
                transition-colors duration-150
                hover:bg-surface/70
                active:bg-surface/40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
              "
              style={{
                fontFamily: "'Inter Display', system-ui, sans-serif",
                fontSize: '14px',
                lineHeight: '18px',
                fontWeight: '600',
              }}
              aria-label="Добавить .md файл"
            >
              Добавить .md файл
            </button>
          </div>
        </div>

        {/* External Links */}
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              padding: '1px',
            }}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            <LinkInputGroup
              resourceName={linkName}
              onResourceNameChange={setLinkName}
              url={linkUrl}
              onUrlChange={setLinkUrl}
              onAddLink={handleAddLink}
            />
          </div>
        </div>
      </Section>

      {/* ===== Section: Модификации ===== */}
      <Section>
        <BoardHeader title="Модификации" />

        {/* Signals toggle + counters */}
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              padding: '1px',
            }}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-bg-light"
                style={{
                  fontFamily: "'Inter Display', system-ui, sans-serif",
                  fontSize: '16px',
                  lineHeight: '20px',
                  fontWeight: '500',
                  letterSpacing: '-0.0313em',
                }}
              >
                Сигналы светофора
              </span>
              <Toggle
                checked={signalsEnabled}
                onChange={setSignalsEnabled}
                aria-label="Включить сигналы светофора"
              />
            </div>

            {/* Description */}
            <p
              className="text-text-muted mb-3"
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontSize: '12px',
                lineHeight: '16px',
                letterSpacing: '-0.0417em',
                fontWeight: '400',
              }}
            >
              Обозначьте срок, при котором коллегам будет приходить дополнительное уведомление о скором дедлайне задачи
            </p>

            {/* Signal counters */}
            <div className="space-y-3">
              {signalValues.map((signal, index) => (
                <Counter
                  key={index}
                  value={signal.value}
                  label={signal.label}
                  onChange={(val) => handleSignalChange(index, val)}
                  disabled={!signalsEnabled}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ===== Submit Button ===== */}
      <div className="w-full">
        <SubmitButton loading={loading} type="submit" />
      </div>

      {/* Bottom filler for safe area */}
      <div
        className="w-full"
        style={{ height: '64px', backgroundColor: '#0A0A0A' }}
        aria-hidden="true"
      />
    </form>
  );
}

/**
 * Section wrapper with consistent styling.
 */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col w-full gap-3">
      {children}
    </section>
  );
}