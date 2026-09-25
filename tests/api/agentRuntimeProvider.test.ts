// Tests for agent-runtime provider contract: summary/details/attachments are separate.
import { describe, it, expect } from 'vitest';
import { buildMessages, formatHumanDetails, normalizeResult } from '../../supabase/functions/agent-runtime/provider';

const makeRequest = () => ({
  baseUrl: 'https://example.test',
  apiKey: 'secret',
  model: null,
  skills: [],
  autonomy: 'tasks',
  workspaceName: null,
  task: {
    full_id: 'ONIT-36',
    title: 'Закупить огурцы и водку',
    description: null,
    column: 'in_progress',
    priority: 'medium',
    deadline: null,
    is_blocked: false,
    metadata: {},
  },
  comments: [],
  subgraph: [],
});

describe('agent-runtime provider: result contract', () => {
  it('strict result keeps summary, details and attachments separate', () => {
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
      details: 'Полный отчёт с поставщиками и следующими шагами',
      metadata: { document_format: 'xlsx' },
      next_owner: null,
      attachments: [{ filename: 'suppliers.xlsx', content_base64: '...' }],
    });
    expect(result).toMatchObject({
      outcome: 'review',
      summary: 'Краткий итог',
      details: 'Полный отчёт с поставщиками и следующими шагами',
      attachments: [{ filename: 'suppliers.xlsx' }],
      coerced: false,
    });
  });

  it('legacy envelope does not turn a domain object into a comment', () => {
    const result = normalizeResult({
      task_id: 'ONIT-36',
      status: 'completed',
      result: {
        summary: 'Найдены поставщики',
        suppliers: { cucumbers: 'Agroserver' },
        next_steps: ['Позвонить поставщику'],
      },
    });
    expect(result?.summary).toBe('Найдены поставщики');
    expect(result?.details).toBeNull();
    expect(result?.coerced).toBe(true);
  });

  it('legacy envelope accepts ready-made details text', () => {
    const result = normalizeResult({
      task_id: 'ONIT-36',
      status: 'completed',
      result: {
        summary: 'Найдены поставщики',
        details: 'Поставщики: Agroserver.\nСледующий шаг: позвонить поставщику.',
      },
    });
    expect(result?.details).toContain('Поставщики: Agroserver');
  });

  it('JSON string in details is rejected instead of being shown as raw JSON', () => {
    const details = formatHumanDetails('{"next_steps":["Связаться с поставщиком"]}');
    expect(details).toBeNull();
  });

  it('ordinary details text is preserved without attempting translation', () => {
    const details = formatHumanDetails('Поставщик: METRO. Следующий шаг: оформить заказ.');
    expect(details).toBe('Поставщик: METRO. Следующий шаг: оформить заказ.');
  });

  it('строгий review без details отклоняется', () => {
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
    });
    expect(result).toBeNull();
  });

  it('prompt describes the three result levels and XLSX/DOCX artifacts', () => {
    const system = buildMessages(makeRequest())[0].content;
    expect(system).toContain('details');
    expect(system).toContain('attachments');
    expect(system).toContain('xlsx');
    expect(system).toContain('docx');
    expect(system).toContain('обязательно для outcome="review"');
    expect(system).toContain('Не возвращай JSON или структурированный объект');
    expect(system).toContain('без текста до и после');
  });
});
