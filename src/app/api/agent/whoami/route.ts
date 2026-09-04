// GET /api/agent/whoami — WorkerPlan §10.6 (RUNNER-02 server dependency).
// One call for the worker: agent identity + Realtime wake config.
// Auth: Bearer mcp_agent_key (A-2); identity from key only (INV 9).
// supabase_url / supabase_anon_key are publishable (NEXT_PUBLIC_*) values —
// safe to hand out for the PUBLIC wake channel agent:<agent_key_id> (no JWT;
// ADR 12, migration 071). Missing env → nulls: worker falls back to poll-only.

import {
  bearerFromHeaders,
  resolveAgentKey,
  resolveAgentWorkerId,
} from '@core/shared/mcpAuth';
import { toDomainError } from '@core/shared/errors';

export async function GET(req: Request) {
  try {
    const rawKey = bearerFromHeaders(req.headers);
    if (!rawKey) {
      return Response.json(
        {
          success: false,
          error: {
            code: 401,
            type: 'unauthorized',
            message: 'Provide Authorization: Bearer <key>.',
          },
        },
        { status: 401 }
      );
    }

    const key = await resolveAgentKey(rawKey);

    // INV-04 zero-config onboarding (mirrors POST /api/mcp and transport.ts):
    // the worker of an authenticated agent materializes on its very first
    // call — whoami is typically that call. Fail-open, never fails the request.
    try {
      await resolveAgentWorkerId(key.keyAgentName, key.workspaceId);
    } catch (onboardingErr) {
      console.error('agent worker onboarding failed:', onboardingErr);
    }

    return Response.json(
      {
        workspace_id: key.workspaceId,
        agent_name: key.keyAgentName,
        allowed_tools: key.allowedTools,
        agent_key_id: key.agentKeyId,
        supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
        supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    const domainErr = toDomainError(err);
    return Response.json(
      { success: false, error: domainErr.toBody() },
      { status: domainErr.code }
    );
  }
}