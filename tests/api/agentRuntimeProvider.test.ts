// Tests for agent-runtime provider contract: summary/details/attachments are separate.
import { describe, it, expect } from 'vitest';
import { buildMessages, normalizeResult } from '../../supabase/functions/agent-runtime/provider';

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

  it('legacy envelope preserves structured result as details', () => {
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
    expect(result?.details).toContain('suppliers');
    expect(result?.details).toContain('Позвонить поставщику');
    expect(result?.coerced).toBe(true);
  });

  it('old strict result without details remains valid and does not invent a comment', () => {
    const result = normalizeResult({
      outcome: 'review',
      summary: 'Краткий итог',
      next_owner: null,
    });
    expect(result?.summary).toBe('Краткий итог');
    expect(result?.details).toBeNull();
  });

  it('prompt describes the three result levels and XLSX/DOCX artifacts', () => {
    const system = buildMessages(makeRequest())[0].content;
    expect(system).toContain('details');
    expect(system).toContain('attachments');
    expect(system).toContain('xlsx');
    expect(system).toContain('docx');
    expect(system).toContain('без текста до и после');
  });
});
