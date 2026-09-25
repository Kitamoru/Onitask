import { describe, expect, it } from 'vitest';
import { buildFlowMetrics, type BuildFlowMetricsInput } from '@/lib/server/flowMetrics';

function baseInput(overrides: Partial<BuildFlowMetricsInput> = {}): BuildFlowMetricsInput {
  return {
    workspaceId: 'ws-1',
    tasks: [],
    workers: [],
    attentionRiskRows: [],
    reviewBacklogRows: [],
    stuckTaskRows: [],
    orphanBlockerRows: [],
    pendingEscalationRows: [],
    enableCognitiveBudget: true,
    flowConfig: {},
    ...overrides,
  };
}

function task(overrides: Partial<BuildFlowMetricsInput['tasks'][number]> = {}) {
  return {
    id: 't-1',
    workspace_id: 'ws-1',
    column: 'in_progress',
    assigned_to: 'w-1',
    reviewer_id: null,
    cognitive_weight: 1,
    is_inbox: false,
    is_blocked: false,
    needs_human: false,
    moved_to_column_at: null,
    ...overrides,
  };
}

describe('buildFlowMetrics', () => {
  it('counts F-01 assigned and reviewer load for a human worker', () => {
    const result = buildFlowMetrics(baseInput({
      workers: [{ id: 'w-1', workspace_id: 'ws-1', type: 'human', display_name: 'Vadim', role: 'member', role_title: null }],
      tasks: [
        task({ cognitive_weight: 2 }),
        task({ column: 'review', assigned_to: null, reviewer_id: 'w-1', cognitive_weight: 1 }),
        task({ is_inbox: true, cognitive_weight: 3 }),
      ],
    }));

    expect(result.workers[0].cognitive_load).toBe(3);
    expect(result.risk.people).toBe(1);
  });

  it('returns zero F-01 load when the cognitive budget is disabled', () => {
    const result = buildFlowMetrics(baseInput({
      enableCognitiveBudget: false,
      workers: [{ id: 'w-1', workspace_id: 'ws-1', type: 'human', display_name: 'Vadim', role: 'member', role_title: null }],
      tasks: [task({ cognitive_weight: 3 })],
    }));

    expect(result.workers[0].cognitive_load).toBe(0);
    expect(result.risk.people).toBe(0);
  });

  it('does not use A-11 attention score as the F-01 people count', () => {
    const result = buildFlowMetrics(baseInput({
      workers: [{ id: 'w-1', workspace_id: 'ws-1', type: 'human', display_name: 'Vadim', role: 'member', role_title: null }],
      attentionRiskRows: [{ worker_id: 'w-1', attention_risk_score: 90, risk_level: 'critical' }],
    }));

    expect(result.workers[0].attention_risk_score).toBe(90);
    expect(result.workers[0].attention_risk_level).toBe('critical');
    expect(result.risk.people).toBe(0);
  });

  it('sums review backlog, stuck tasks, and orphan blockers into processes', () => {
    const result = buildFlowMetrics(baseInput({
      reviewBacklogRows: [{ reviewer_id: 'w-1', reviewer_name: 'Vadim', review_count: 3, workspace_id: 'ws-1' }],
      stuckTaskRows: [{ id: 't-1', title: 'Stuck', column: 'in_progress', assigned_to: null, assignee_name: null, hours_stuck: 80, workspace_id: 'ws-1' }],
      orphanBlockerRows: [{ id: 't-2', title: 'Phantom', column: 'backlog', assigned_to: null, assignee_name: null, hours_blocked: 5, workspace_id: 'ws-1' }],
    }));

    expect(result.risk.processes).toBe(3);
    expect(result.riskBreakdown.processes).toEqual({
      reviewBacklog: expect.any(Array),
      stuck: expect.any(Array),
      orphanBlockers: expect.any(Array),
    });
  });

  it('keeps handoff_chain out of the Processes signal', () => {
    const result = buildFlowMetrics(baseInput({
      stuckTaskRows: [{ id: 't-1', title: 'Stuck', column: 'in_progress', assigned_to: null, assignee_name: null, hours_stuck: 80, workspace_id: 'ws-1' }],
    }));

    expect(result.risk.processes).toBe(1);
    expect(result.riskBreakdown.processes).not.toHaveProperty('handoffChain');
  });

  it('calculates velocity from done task story points inside the window', () => {
    const result = buildFlowMetrics(baseInput({
      velocityWindowDays: 14,
      workers: [{ id: 'w-1', workspace_id: 'ws-1', type: 'human', display_name: 'Vadim', role: 'member', role_title: null }],
      tasks: [{ ...task({ id: 't-done', column: 'done', moved_to_column_at: new Date().toISOString() }) }],
      enrichmentRows: [{ task_id: 't-done', story_points: 7 }],
      reworkRows: [{ task_id: 't-done', worker_id: 'w-1', from_column: 'review', to_column: 'in_progress', moved_at: new Date().toISOString() }],
    }));

    expect(result.workers[0].sp_per_day).toBe(0.5);
    expect(result.workers[0].completed_story_points).toBe(7);
    expect(result.workers[0].velocity_window_days).toBe(14);
    expect(result.workers[0].rework_count).toBe(1);
    expect(result.workers[0].rework_rate).toBe(1);
  });

  it('ignores completed tasks outside the velocity window', () => {
    const result = buildFlowMetrics(baseInput({
      velocityWindowDays: 14,
      workers: [{ id: 'w-1', workspace_id: 'ws-1', type: 'human', display_name: 'Vadim', role: 'member', role_title: null }],
      tasks: [
        { ...task({ id: 't-old', column: 'done', moved_to_column_at: '2020-01-01T00:00:00.000Z' }) },
      ],
      enrichmentRows: [{ task_id: 't-old', story_points: 7 }],
    }));

    expect(result.workers[0].sp_per_day).toBe(0);
  });

  it('scopes anomaly rows to the requested workspace', () => {
    const result = buildFlowMetrics(baseInput({
      pendingEscalationRows: [
        { id: 't-1', title: 'Local', escalation_reason: null, workspace_id: 'ws-1', assigned_agent: null, hours_pending: 1 },
        { id: 't-2', title: 'Foreign', escalation_reason: null, workspace_id: 'ws-2', assigned_agent: null, hours_pending: 1 },
      ],
    }));

    expect(result.risk.escalations).toBe(1);
    expect(result.riskBreakdown.escalations).toHaveLength(1);
  });
});
