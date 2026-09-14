// GET /api/agent/whoami — WorkerPlan §10.6 (RUNNER-02 server dependency).
// One call for the worker: agent identity only.
// Auth: Bearer mcp_agent_key (A-2); identity from key only (INV 9).
//
// Security: this endpoint returns identity ONLY — no Supabase keys/URLs.
// Agents work via MCP, not direct Supabase access. If an agent needs
// Realtime wake, it uses the public channel 'agent:<agent_name>' (migration
// 072) with NEXT_PUBLIC_* values injected at build/deploy time — never
// through this response. RLS policies (verified) already restrict anon-key
// access to workspace-member scope; we avoid expanding the attack surface.

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