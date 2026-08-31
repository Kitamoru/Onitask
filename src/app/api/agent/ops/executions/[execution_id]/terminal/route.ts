// POST /api/agent/ops/executions/[execution_id]/terminal — Arch 0.9 Ops API (01 §3).
// Fenced agent completion: review | escalate | handoff. Never move_task (INV 4).

import {
  handleOpsRequest,
  requireUuid,
  requireString,
  callOpsRpc,
  OpsApiError,
} from '@core/shared/opsTransport';

const OUTCOMES = new Set(['review', 'escalate', 'handoff']);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ execution_id: string }> }
) {
  const { execution_id } = await params;
  return handleOpsRequest(req, async (_ctx, body) => {
    const executionId = requireUuid(execution_id, 'execution_id');
    const runtimeId = requireUuid(body.runtime_id, 'runtime_id');
    const taskId = requireUuid(body.task_id, 'task_id');

    if (
      typeof body.task_version !== 'number' ||
      !Number.isInteger(body.task_version)
    ) {
      throw new OpsApiError(400, 'invalid_request', "'task_version' must be an integer.");
    }

    if (typeof body.outcome !== 'string' || !OUTCOMES.has(body.outcome)) {
      throw new OpsApiError(
        400,
        'invalid_request',
        "'outcome' must be one of: review, escalate, handoff."
      );
    }

    const summary =
      body.summary === undefined || body.summary === null
        ? null
        : requireString(body.summary, 'summary');

    const metadata =
      body.metadata === undefined || body.metadata === null
        ? {}
        : body.metadata;
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new OpsApiError(400, 'invalid_request', "'metadata' must be an object.");
    }

    const nextOwner =
      body.next_owner === undefined || body.next_owner === null
        ? null
        : requireString(body.next_owner, 'next_owner');

    return callOpsRpc('ops_terminal', {
      p_execution_id: executionId,
      p_runtime_id: runtimeId,
      p_task_id: taskId,
      p_task_version: body.task_version,
      p_outcome: body.outcome,
      p_summary: summary,
      p_metadata: metadata,
      p_next_owner: nextOwner,
    });
  });
}
