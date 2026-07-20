'use client';

import React, { useState } from 'react';
import { BoardHeader } from './Header';
import { TextInput } from './TextInput';
import { Toggle } from './Toggle';
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
 * Design tokens: all colors, spacing, typography use CSS variables
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

  // Functional settings
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

  // Documents
  const [documentsEnabled, setDocumentsEnabled] = useState(false);
  const [documents, setDocuments] = useState<File[]>(initialData.documents || []);

  // External links
  const [linksEnabled, setLinksEnabled] = useState(false);
  const [links, setLinks] = useState<Array<{ name: string; url: string }>>(
    initialData.externalLinks || []
  );

  // Signals
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

  // Shared styles
  const sectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    gap: '8px',
  };

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundImage: 'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
    backgroundOrigin: 'border-box',
    backgroundClip: 'content-box, border-box',
    padding: '1px',
  };

  const cardInnerStyle: React.CSSProperties = {
    padding: '12px',
    backgroundColor: '#1A1A1A',
  };

  const headerRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "'Inter Display', system-ui, sans-serif",
    fontSize: '16px',
    lineHeight: '1.25',
    fontWeight: '500',
    letterSpacing: '-0.0313em',
    color: '#FAFAFA',
  };

  const descriptionStyle: React.CSSProperties = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: '12px',
    lineHeight: '1.33',
    letterSpacing: '-0.0417em',
    fontWeight: '400',
    color: '#8B8B8B',
    marginBottom: '12px',
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: '358px',
        margin: '0 auto',
        padding: '16px',
        gap: '24px',
        minHeight: '100dvh',
        backgroundColor: '#0A0A0A',
        overflowY: 'auto',
      }}
      noValidate
    >
      {/* Global error */}
      {globalError && (
        <div
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            color: '#F59E0B',
          }}
          role="alert"
        >
          {globalError}
        </div>
      )}

      {/* ===== Section: Основное ===== */}
      <section style={sectionStyle}>
        <BoardHeader title="Основное" />
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
              <p style={{ marginTop: '4px', fontSize: '12px', color: '#EF4444' }} role="alert">
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
              <p style={{ marginTop: '4px', fontSize: '12px', color: '#EF4444' }} role="alert">
                {slugError}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ===== Section: Функциональное ===== */}
      <section style={sectionStyle}>
        <BoardHeader title="Функциональное" />

        {/* Story Points Toggle */}
        <div style={{ ...cardStyle, marginTop: '16px' }}>
          <div style={cardInnerStyle}>
            <div style={headerRowStyle}>
              <span style={labelStyle}>Стоимость сторипоинта</span>
              <Toggle
                checked={spEnabled}
                onChange={setSpEnabled}
                aria-label="Включить story points"
              />
            </div>

            {/* SP value inputs */}
            {spEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {['1 SP', '3 SP', '5 SP', '7 SP', '13 SP'].map((label, index) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        ...labelStyle,
                        fontSize: '14px',
                        width: '40px',
                        flexShrink: 0,
                      }}
                    >
                      {label}
                    </span>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: '4px',
                          backgroundImage: 'linear-gradient(135deg, rgba(250,250,250,0.38) 0%, rgba(250,250,250,0.08) 50%, rgba(250,250,250,0.38) 100%)',
                          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                          maskComposite: 'exclude',
                          WebkitMaskComposite: 'xor',
                          padding: '1px',
                          pointerEvents: 'none',
                        }}
                        aria-hidden="true"
                      />
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px' }}>
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
                          style={{
                            flex: 1,
                            minWidth: 0,
                            backgroundColor: 'transparent',
                            color: '#FAFAFA',
                            fontFamily: "'Inter', system-ui, sans-serif",
                            fontSize: '14px',
                            fontWeight: '500',
                            outline: 'none',
                            border: 'none',
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
        <div style={{ ...cardStyle, marginTop: '16px' }}>
          <div style={cardInnerStyle}>
            <div style={{ ...headerRowStyle, marginBottom: '8px' }}>
              <span style={labelStyle}>Когнитивный вес</span>
              <Toggle
                checked={cwEnabled}
                onChange={setCwEnabled}
                aria-label="Включить когнитивный вес"
              />
            </div>

            {cwEnabled && (
              <p style={descriptionStyle}>
                Текст описание функционала когнитивного веса задачи, который расписан в 2-3 строчки, чтобы пользователь понимал, что оно из себя представляет
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ===== Section: Контекст доски ===== */}
      <section style={sectionStyle}>
        <BoardHeader title="Контекст доски" />
        <div style={{ marginTop: '16px' }}>
          <TextArea
            placeholder="Краткое описание"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            maxLength={1200}
            aria-label="Контекст доски"
          />
        </div>
      </section>

      {/* ===== Section: Дополнительные материалы ===== */}
      <section style={sectionStyle}>
        <BoardHeader title="Дополнительные материалы" />
        
        {/* Documents toggle */}
        <div style={{ ...cardStyle, marginTop: '16px' }}>
          <div style={cardInnerStyle}>
            <div style={headerRowStyle}>
              <span style={labelStyle}>Документы</span>
              <Toggle
                checked={documentsEnabled}
                onChange={setDocumentsEnabled}
                aria-label="Включить документы"
              />
            </div>

            {documentsEnabled && (
              <>
                {documents.map((doc, index) => (
                  <div key={index} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FilePicker
                      file={doc}
                      onChange={(file) => handleDocumentChange(index, file)}
                    />
                    {documents.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDocument(index)}
                        style={{
                          flexShrink: 0,
                          width: '32px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(26, 26, 26, 0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#FAFAFA',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      height: '40px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(26, 26, 26, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#FAFAFA',
                      fontFamily: "'Inter Display', system-ui, sans-serif",
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
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

        {/* External Links toggle */}
        <div style={{ ...cardStyle, marginTop: '16px' }}>
          <div style={cardInnerStyle}>
            <div style={headerRowStyle}>
              <span style={labelStyle}>Внешние ссылки</span>
              <Toggle
                checked={linksEnabled}
                onChange={setLinksEnabled}
                aria-label="Включить внешние ссылки"
              />
            </div>

            {linksEnabled && (
              <>
                {links.map((link, idx) => (
                  <div key={idx} style={{ marginBottom: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
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
                        style={{
                          flexShrink: 0,
                          width: '32px',
                          height: '32px',
                          marginTop: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(26, 26, 26, 0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#FAFAFA',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                        aria-label={`Удалить ссылку ${idx + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                {links.length < MAX_EXTERNAL_LINKS && (
                  <div style={{ marginTop: '8px' }}>
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

                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#8B8B8B',
                      fontFamily: "'Inter', system-ui, sans-serif",
                    }}
                  >
                    {links.length}/{MAX_EXTERNAL_LINKS}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ===== Section: Модификации ===== */}
      <section style={sectionStyle}>
        <BoardHeader title="Модификации" />

        {/* Signals toggle */}
        <div style={{ ...cardStyle, marginTop: '16px' }}>
          <div style={cardInnerStyle}>
            <div style={{ ...headerRowStyle, marginBottom: '8px' }}>
              <span style={labelStyle}>Сигналы светофора</span>
              <Toggle
                checked={signalsEnabled}
                onChange={setSignalsEnabled}
                aria-label="Включить сигналы светофора"
              />
            </div>

            {signalsEnabled && (
              <>
                <p style={descriptionStyle}>
                  Обозначьте срок, при котором коллегам будет приходить дополнительное уведомление о скором дедлайне задачи
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {signalValues.map((signal, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleSignalDecrement(index)}
                        disabled={!signalsEnabled}
                        style={{
                          width: '32px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(26, 26, 26, 0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#FAFAFA',
                          fontWeight: '600',
                          cursor: 'pointer',
                          opacity: !signalsEnabled ? 0.5 : 1,
                        }}
                        aria-label={`Уменьшить количество дней для ${signal.label}`}
                      >
                        −
                      </button>
                      <div
                        style={{
                          flex: 1,
                          height: '32px',
                          padding: '0 12px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: `1px solid ${index === 0 ? '#F59E0B' : '#EF4444'}`,
                          color: '#FAFAFA',
                          fontFamily: "'Inter', system-ui, sans-serif",
                          fontSize: '14px',
                          fontWeight: '500',
                        }}
                      >
                        {signal.value}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSignalIncrement(index)}
                        disabled={!signalsEnabled}
                        style={{
                          width: '32px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(26, 26, 26, 0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#FAFAFA',
                          fontWeight: '600',
                          cursor: 'pointer',
                          opacity: !signalsEnabled ? 0.5 : 1,
                        }}
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
      </section>

      {/* ===== Submit Button ===== */}
      <div style={{ width: '100%' }}>
        <SubmitButton loading={loading} type="submit" />
      </div>

      {/* Bottom filler for safe area */}
      <div
        style={{ width: '100%', height: '64px', backgroundColor: '#0A0A0A' }}
        aria-hidden="true"
      />
    </form>
  );
}