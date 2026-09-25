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
    expect(result?.details).toContain('Поставщики');
    expect(result?.details).toContain('Позвонить поставщику');
    expect(result?.details).not.toContain('{');
    expect(result?.details).not.toContain('}');
    expect(result?.details).not.toContain('"');
    expect(result?.coerced).toBe(true);
  });

  it('formats a realistic ONIT-36 result as readable Russian text', () => {
    const result = normalizeResult({
      task_id: 'ONIT-36',
      status: 'completed',
      result: {
        summary: 'Найдены поставщики для огурцов и водки',
        suppliers: {
          ogurtsy_15t: {
            recommended: { name: 'Agroserver', price: 'от 10 руб/кг', min_order: 'от 10 тонн' },
            alternatives: [{ name: 'Фрутомания', phone: '+7 (495) 215-05-99' }],
          },
          vodka_15b: { recommended: { name: 'METRO', note: 'Мелкий опт' } },
        },
        next_steps: ['Позвонить поставщику', 'Согласовать доставку'],
        estimated_cost: { total: '~155 000–160 000 руб.' },
      },
    });

    expect(result?.details).toContain('Огурцы, 15 тонн');
    expect(result?.details).toContain('Рекомендованный вариант');
    expect(result?.details).toContain('Следующие шаги');
    expect(result?.details).toContain('Ориентировочная стоимость');
    expect(result?.details).toContain('• Позвонить поставщику');
    expect(result?.details).not.toContain('suppliers');
    expect(result?.details).not.toContain('"recommended"');
  });

  it('formats JSON strings in details without leaking JSON artifacts', () => {
    const details = formatHumanDetails('{"next_steps":["Связаться с поставщиком"],"estimated_cost":"160 000 руб."}');
    expect(details).toContain('Следующие шаги');
    expect(details).toContain('Ориентировочная стоимость');
    expect(details).not.toContain('{');
    expect(details).not.toContain('}');
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
