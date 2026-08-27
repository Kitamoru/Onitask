// lib/shared/transport.ts
// Shared plumbing for REST /api/agent/* routes (contract v0.8.0 §2.2).
// Pattern: bearer → assertAgentRequest → ensure worker (INV-04) → domain service → envelope.
// DomainError → { error: { code, type, message } } with HTTP status = code.

import {
  assertAgentRequest,
  bearerFromHeaders,
  resolveAgentWorkerId,
} from './mcpAuth';
import { toDomainError } from './errors';
import type { AgentRequestContext } from './mcpAuth';

export interface AgentRequestBody {
  workspace_id?: string;
  agent_name?: string;
  [key: string]: unknown;
}

/**
 * Run a domain service behind the 4 security checks and serialize the result.
 */
export async function handleAgentRequest<T>(
  req: Request,
  toolName: string,
  service: (
    ctx: AgentRequestContext,
    body: AgentRequestBody
  ) => Promise<T>
): Promise<Response> {
  try {
    const rawKey = bearerFromHeaders(req.headers);
    let body: AgentRequestBody = {};
    try {
      body = (await req.json()) as AgentRequestBody;
    } catch {
      body = {}; // empty body allowed for tools without params beyond auth
    }

    const ctx = await assertAgentRequest({
      rawKey,
      body,
      toolName,
    });

    // INV-04 zero-config onboarding (mirrors POST /api/mcp): the worker of an
    // authenticated agent must exist from its very first call. Fail-open —
    // onboarding failure is logged but never fails the request itself.
    try {
      await resolveAgentWorkerId(ctx.agentName, ctx.workspaceId);
    } catch (onboardingErr) {
      console.error('agent worker onboarding failed:', onboardingErr);
    }

    const result = await service(ctx, body);
    return Response.json(result, { status: 200 });
  } catch (err) {
    const domainErr = toDomainError(err);
    return Response.json(
      { success: false, error: domainErr.toBody() },
      { status: domainErr.code }
    );
  }
}