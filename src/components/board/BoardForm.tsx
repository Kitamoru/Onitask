'use client';

import React, { useState } from 'react';
import { BoardHeader } from './Header';
import { TextInput } from './TextInput';
import { Toggle } from './Toggle';
import { Counter } from './Counter';
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
 * 
 * Design tokens: all colors, spacing, typography use CSS variables from src/styles/tokens.css
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
const MAX_DOCUMENTS = 10;
const MAX_EXTERNAL_LINKS = 6;

/** Shared gradient border style — extracted from token variables */
const GRADIENT_BORDER_STYLE: React.CSSProperties = {
  backgroundImage: `linear-gradient(135deg, var(--gradient-border-start) 0%, var(--gradient-border-mid) 50%, var(--gradient-border-end) 100%)`,
  borderRadius: 'var(--radius-sm)',
  mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
  maskComposite: 'exclude',
  WebkitMaskComposite: 'xor',
  padding: '1px',
};

const DEFAULT_SIGNALS = [
  { value: 3, label: '3 дня' },
  { value: 1, label: '1 день' },
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
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);

  // Functional settings — все toggle выключены по умолчанию
  const [spEnabled, setSpEnabled] = useState(initialData.storyPoints?.enabled ?? false);
  const [spValues, setSpValues] = useState<[number, number, number, number, number]>(
    initialData.storyPoints?.values || DEFAULT_SP_VALUES
  );

  const [cwEnabled, setCwEnabled] = useState(initialData.cognitiveWeight?.enabled ?? false);
  const [cwDescription, setCwDescription] = useState(
    initialData.cognitiveWeight?.description || ''
  );

  // Context
  const [context, setContext] = useState(initialData.context || '');

  // Documents — toggle выключен по умолчанию, поддержка до 10 файлов
  const [documentsEnabled, setDocumentsEnabled] = useState(false);
  const [documents, setDocuments] = useState<File[]>(initialData.documents || []);

  // External links — toggle выключен по умолчанию, до 6 ссылок
  const [linksEnabled, setLinksEnabled] = useState(false);
  const [links, setLinks] = useState<Array<{ name: string; url: string }>>(
    initialData.externalLinks || []
  );

  // Signals — toggle выключен по умолчанию
  const [signalsEnabled, setSignalsEnabled] = useState(
    initialData.signals?.enabled ?? false
  );
  const [signalValues, setSignalValues] = useState(
    initialData.signals?.values || DEFAULT_SIGNALS
  );

  // Validation handlers
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length <= 25) {
      setName(val);
      if (val.length > 25) {
        setNameError('Максимум 25 символов');
      } else {
        setNameError(undefined);
      }
    }
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 5);
    setSlug(val);
    if (val.length > 0 && (val.length < 4 || val.length > 5)) {
      setSlugError('Должно быть 4 или 5 символов');
    } else {
      setSlugError(undefined);
    }
  };

  const handleAddLink = () => {
    if (links.length >= MAX_EXTERNAL_LINKS) return;
    setLinks([...links, { name: '', url: '' }]);
  };

  const handleUpdateLink = (index: number, field: 'name' | 'url', value: string) => {
    setLinks(links.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  const handleSignalIncrement = (index: number) => {
    setSignalValues((prev) =>
      prev.map((s, i) => (i === index ? { ...s, value: s.value + 1 } : s))
    );
  };

  const handleSignalDecrement = (index: number) => {
    setSignalValues((prev) =>
      prev.map((s, i) => (i === index ? { ...s, value: Math.max(1, s.value - 1) } : s))
    );
  };

  // Document handlers
  const handleDocumentChange = (index: number, file: File | null) => {
    setDocuments((prev) => {
      const updated = [...prev];
      updated[index] = file!;
      return updated;
    });
  };

  const handleAddDocument = () => {
    if (documents.length < MAX_DOCUMENTS) {
      setDocuments([...documents, null as unknown as File]);
    }
  };

  const handleRemoveDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate before submit
    let hasErrors = false;
    if (name.length === 0 || name.length > 25) {
      setNameError(name.length > 25 ? 'Максимум 25 символов' : 'Введите название');
      hasErrors = true;
    }
    if (slug.length > 0 && (slug.length < 4 || slug.length > 5)) {
      setSlugError('Должно быть 4 или 5 символов');
      hasErrors = true;
    }
    if (hasErrors) return;

    const formData: BoardFormData = {
      name,
      slug,
      storyPoints: { enabled: spEnabled, values: spValues },
      cognitiveWeight: { enabled: cwEnabled, description: cwDescription },
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
      className="
        flex flex-col w-full max-w-form mx-auto
        overflow-y-auto
        bg-primary-dark
        form-container
        /* Safe area padding for mobile */
        xs:px-3 sm:px-4
        pt-safe-top pb-safe-bottom
      "
      style={{ 
        padding: 'var(--spacing-4)',
        gap: 'var(--spacing-section-gap)',
        minHeight: 'var(--tg-viewport-stable-height, 100dvh)',
      }}
      noValidate
    >
      {/* Global error */}
      {globalError && (
        <div
          className="px-4 py-2 rounded-md text-sm"
          style={{ backgroundColor: 'var(--color-accent-amber-subtle)', color: 'var(--color-accent-amber)' }}
          role="alert"
        >
          {globalError}
        </div>
      )}

      {/* ===== Section: Основное ===== */}
      <Section>
        <BoardHeader title="Основное" />
        <div className="mt-4 space-y-3">
          <div>
            <TextInput
              id="board-name"
              placeholder="Название доски"
              value={name}
              onChange={handleNameChange}
              size="md"
              aria-label="Название доски"
            />
            {nameError && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }} role="alert">
                {nameError}
              </p>
            )}
          </div>
          <div>
            <TextInput
              id="board-slug"
              placeholder="@desk"
              value={slug}
              onChange={handleSlugChange}
              size="md"
              aria-label="Идентификатор доски"
            />
            {slugError && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }} role="alert">
                {slugError}
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ===== Section: Функциональное ===== */}
      <Section>
        <BoardHeader title="Функциональное" />

        {/* Story Points Toggle */}
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={GRADIENT_BORDER_STYLE}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Header row — toggle справа */}
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-primary"
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-heading-md)',
                  lineHeight: 'var(--text-heading-md-line)',
                  fontWeight: 'var(--font-weight-medium)',
                  letterSpacing: 'var(--letter-spacing-tight)',
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
                      className="text-primary shrink-0"
                      style={{
                        fontFamily: 'var(--font-family-display)',
                        fontSize: 'var(--text-body-md)',
                        lineHeight: 'var(--text-body-md-line)',
                        fontWeight: 'var(--font-weight-medium)',
                        width: '40px',
                      }}
                    >
                      {label}
                    </span>
                    <div className="relative flex-1">
                      {/* Gradient background shape (Figma input-field-s border) */}
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={GRADIENT_BORDER_STYLE}
                        aria-hidden="true"
                      />
                      <div className="flex items-center w-full" style={{ padding: 'var(--spacing-2.5) var(--spacing-3)' }}>
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
                            flex-1 min-w-0 bg-transparent text-primary outline-none
                            disabled:opacity-50
                            focus-visible:ring-2 focus-visible:ring-accent-amber
                            [-moz-appearance:textfield]
                            [&::-webkit-outer-spin-button]:appearance-none
                            [&::-webkit-inner-spin-button]:appearance-none
                          "
                          style={{
                            fontFamily: 'var(--font-family-base)',
                            fontSize: 'var(--text-body-md)',
                            lineHeight: 'var(--text-body-lg-line)',
                            letterSpacing: 'var(--letter-spacing-tighter)',
                            fontWeight: 'var(--font-weight-medium)',
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
            style={GRADIENT_BORDER_STYLE}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Header row — toggle справа */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-primary"
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-heading-md)',
                  lineHeight: 'var(--text-heading-md-line)',
                  fontWeight: 'var(--font-weight-medium)',
                  letterSpacing: 'var(--letter-spacing-tight)',
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
                className="text-muted mb-3"
                style={{
                  fontFamily: 'var(--font-family-base)',
                  fontSize: 'var(--text-body-sm)',
                  lineHeight: 'var(--text-body-sm-line)',
                  letterSpacing: 'var(--letter-spacing-tightest)',
                  fontWeight: 'var(--font-weight-regular)',
                }}
              >
                Текст описание функционала когнитивного веса задачи, который расписан в 2-3 строчки, чтобы пользователь понимал, что оно из себя представляет
              </p>
            )}
          </div>
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
            maxLength={1200}
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
            style={GRADIENT_BORDER_STYLE}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Docs header — toggle справа */}
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-primary"
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-heading-md)',
                  lineHeight: 'var(--text-heading-md-line)',
                  fontWeight: 'var(--font-weight-medium)',
                  letterSpacing: 'var(--letter-spacing-tight)',
                }}
              >
                Документы
              </span>
              <Toggle
                checked={documentsEnabled}
                onChange={setDocumentsEnabled}
                aria-label="Включить документы"
              />
            </div>

            {/* File pickers — показывается только когда toggle включён */}
            {documentsEnabled && (
              <>
                {documents.map((doc, index) => (
                  <div key={index} className="mb-2 flex items-center gap-2">
                    <FilePicker
                      file={doc}
                      onChange={(file) => handleDocumentChange(index, file)}
                    />
                    {documents.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDocument(index)}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-surface/50 border border-border-white-subtle text-primary font-semibold hover:bg-surface/70 active:bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber"
                        aria-label="Удалить документ"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {documents.length < MAX_DOCUMENTS && (
                  <button
                    type="button"
                    onClick={handleAddDocument}
                    className="
                      flex items-center justify-center w-full h-10
                      rounded-md
                      bg-surface/50
                      border border-border-white-subtle
                      text-primary
                      font-semibold
                      transition-colors duration-fast
                      hover:bg-surface/70
                      active:bg-surface/40
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                    "
                    style={{
                      fontFamily: 'var(--font-family-display)',
                      fontSize: 'var(--text-body-md)',
                      lineHeight: 'var(--text-body-md-line)',
                      fontWeight: 'var(--font-weight-semibold)',
                    }}
                    aria-label="Добавить документ"
                  >
                    Добавить документ
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* External Links — toggle справа */}
        <div className="mt-4 relative rounded-card overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={GRADIENT_BORDER_STYLE}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-primary"
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-heading-md)',
                  lineHeight: 'var(--text-heading-md-line)',
                  fontWeight: 'var(--font-weight-medium)',
                  letterSpacing: 'var(--letter-spacing-tight)',
                }}
              >
                Внешние ссылки
              </span>
              <Toggle
                checked={linksEnabled}
                onChange={setLinksEnabled}
                aria-label="Включить внешние ссылки"
              />
            </div>

            {/* Multiple link rows — up to 6 */}
            {linksEnabled && (
              <>
                {links.map((link, idx) => (
                  <div key={idx} className="mb-2 flex items-start gap-2 group/link-row">
                    <div className="flex-1">
                      <LinkInputGroup
                        resourceName={link.name}
                        onResourceNameChange={(val) => handleUpdateLink(idx, 'name', val)}
                        url={link.url}
                        onUrlChange={(val) => handleUpdateLink(idx, 'url', val)}
                        onAddLink={() => {}}
                        addDisabled={true}
                      />
                    </div>
                    {links.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveLink(idx)}
                        className="
                          shrink-0 w-8 h-8 mt-8 flex items-center justify-center
                          rounded-md bg-surface/50 border border-border-white-subtle
                          text-primary font-semibold
                          hover:bg-surface/70 active:bg-surface/40
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                          transition-colors duration-fast
                        "
                        aria-label={`Удалить ссылку ${idx + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                {/* New link row (if we have capacity) */}
                {links.length < MAX_EXTERNAL_LINKS && (
                  <div className="mt-2">
                    <LinkInputGroup
                      resourceName=""
                      onResourceNameChange={(val) => handleUpdateLink(links.length, 'name', val)}
                      url=""
                      onUrlChange={(val) => handleUpdateLink(links.length, 'url', val)}
                      onAddLink={handleAddLink}
                      addDisabled={false}
                    />
                  </div>
                )}

                {/* Counter badge */}
                <div className="mt-2 flex items-center justify-end">
                  <span
                    className="text-muted text-xs"
                    style={{
                      fontFamily: 'var(--font-family-base)',
                      fontSize: 'var(--text-body-xs)',
                      lineHeight: 'var(--text-body-xs-line)',
                      fontWeight: 'var(--font-weight-regular)',
                    }}
                  >
                    {links.length}/{MAX_EXTERNAL_LINKS}
                  </span>
                </div>
              </>
            )}
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
            style={GRADIENT_BORDER_STYLE}
            aria-hidden="true"
          />
          <div className="p-3 relative">
            {/* Header row — toggle справа */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-primary"
                style={{
                  fontFamily: 'var(--font-family-display)',
                  fontSize: 'var(--text-heading-md)',
                  lineHeight: 'var(--text-heading-md-line)',
                  fontWeight: 'var(--font-weight-medium)',
                  letterSpacing: 'var(--letter-spacing-tight)',
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

            {/* Description and counters — shown only when toggle is on */}
            {signalsEnabled && (
              <>
                <p
                  className="text-muted mb-3"
                  style={{
                    fontFamily: 'var(--font-family-base)',
                    fontSize: 'var(--text-body-sm)',
                    lineHeight: 'var(--text-body-sm-line)',
                    letterSpacing: 'var(--letter-spacing-tightest)',
                    fontWeight: 'var(--font-weight-regular)',
                  }}
                >
                  Обозначьте срок, при котором коллегам будет приходить дополнительное уведомление о скором дедлайне задачи
                </p>

                {/* Signal counters с кнопками +/- */}
                <div className="space-y-3">
                  {signalValues.map((signal, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSignalDecrement(index)}
                        disabled={!signalsEnabled}
                        className="
                          w-8 h-8 flex items-center justify-center
                          rounded-md bg-surface/50 border border-border-white-subtle
                          text-primary font-semibold
                          disabled:opacity-50 disabled:cursor-not-allowed
                          hover:bg-surface/70 active:bg-surface/40
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                        "
                        aria-label={`Уменьшить количество дней для ${signal.label}`}
                      >
                        −
                      </button>
                      <div
                      className={`flex-1 h-8 px-3 rounded-input-sm flex items-center justify-center
                        bg-transparent text-primary border
                        ${index === 0 ? 'border-signal-yellow' : 'border-signal-red'}
                        disabled:opacity-50`}
                        style={{
                          fontFamily: 'var(--font-family-base)',
                          fontSize: 'var(--text-body-md)',
                          lineHeight: 'var(--text-body-lg-line)',
                          letterSpacing: 'var(--letter-spacing-tighter)',
                          fontWeight: 'var(--font-weight-medium)',
                        }}
                      >
                        {signal.value}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSignalIncrement(index)}
                        disabled={!signalsEnabled}
                        className="
                          w-8 h-8 flex items-center justify-center
                          rounded-md bg-surface/50 border border-border-white-subtle
                          text-primary font-semibold
                          disabled:opacity-50 disabled:cursor-not-allowed
                          hover:bg-surface/70 active:bg-surface/40
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber
                        "
                        aria-label={`Увеличить количество дней для ${signal.label}`}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
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
        style={{ height: 'var(--spacing-16)', backgroundColor: 'var(--color-bg-primary-dark)' }}
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