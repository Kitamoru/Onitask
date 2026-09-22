'use server';

/**
 * POST /api/agents/probe — бесплатная проверка подключения агента (0 токенов).
 *
 * Делает `GET {base_url}/models` с Bearer-ключом: подтверждает, что URL живой,
 * отвечает OpenAI-совместимо и ключ принят. В БД ничего не пишет — это гейт
 * перед созданием коннектора (шторка «Добавить агента»).
 *
 * Ошибки маппятся в коды agentEndpoint (SSRF/timeout/401/404/5xx) — UI показывает
 * сообщение пользователю. Ключ в ответ и логи не попадает (INV-19).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  extractInitData,
  getActiveWorkerInWorkspace,
} from '@core/api-auth';
import { probeAgentEndpoint } from '@core/shared/agentEndpoint';

const ADMIN_ROLES = new Set(['owner', 'admin']);

export async function POST(req: NextRequest) {
  try {
    const initData = await extractInitData(req);
    const auth = await authenticateRequest(initData);

    if (!auth.authenticated || !auth.profileId) {
      return NextResponse.json(
        { success: false, error: auth.error || 'unauthorized' },
        { status: auth.status || 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id.trim() : '';
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: 'missing_workspace_id' },
        { status: 400 },
      );
    }

    const actor = await getActiveWorkerInWorkspace(auth.profileId, workspaceId);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }
    if (!ADMIN_ROLES.has(actor.role ?? '')) {
      return NextResponse.json({ success: false, error: 'admin_required' }, { status: 403 });
    }

    const baseUrl = typeof body.base_url === 'string' ? body.base_url : '';
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'missing_api_key', message: 'Укажите API Key агента.' },
        { status: 400 },
      );
    }

    const result = await probeAgentEndpoint({ baseUrl, apiKey });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.code, message: result.message },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        base_url: result.baseUrl,
        models: result.models,
        suggested_model: result.suggestedModel,
      },
    });
  } catch (error) {
    console.error(
      'POST /api/agents/probe error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
