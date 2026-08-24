/**
 * API Authentication Helper
 *
 * Validates Telegram initData on every API request (like /api/init and /api/workspaces).
 * This is the server-side auth mechanism — NOT Supabase Auth.
 *
 * Pattern:
 * 1. Client sends initData from Telegram.WebApp.initData (stored in sessionStorage)
 * 2. Server validates HMAC-SHA256 with bot token (timingSafeEqual)
 * 3. If valid, returns the Telegram user + their profile/worker info
 * 4. Server uses service_role key for all subsequent DB operations
 */

import { validateTelegramInitData } from '../src/lib/telegram/validate';
import { createServerClient } from './supabase';
import type { TelegramUser } from '../src/lib/telegram/validate';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export interface AuthResult {
  authenticated: boolean;
  telegramUser?: TelegramUser;
  profileId?: string;
  displayName?: string;
  error?: string;
  status?: number;
}

/**
 * Authenticate a request by validating Telegram initData.
 * Call this at the top of every API route handler that needs auth.
 *
 * @param initData - Telegram Web App initData string
 * @returns AuthResult with authenticated flag and user/profile info
 */
export async function authenticateRequest(initData: string | undefined): Promise<AuthResult> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('authenticateRequest: TELEGRAM_BOT_TOKEN is not set');
    return { authenticated: false, error: 'server_configuration_error', status: 500 };
  }

  if (!initData) {
    return { authenticated: false, error: 'missing_init_data', status: 400 };
  }

  // 1. Validate Telegram initData
  const validation = validateTelegramInitData(initData, TELEGRAM_BOT_TOKEN);

  if (!validation.valid || !validation.user) {
    return { authenticated: false, error: validation.error || 'invalid_init_data', status: 401 };
  }

  const telegramUser = validation.user;
  const supabase = createServerClient();

  // 2. Find profile by telegram_id
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('telegram_id', Number(telegramUser.id))
    .maybeSingle();

  if (profileError) {
    console.error('authenticateRequest: profile query error', profileError);
    return { authenticated: false, error: 'database_error', status: 500 };
  }

  if (!profileData) {
    return { authenticated: false, error: 'profile_not_found', status: 401 };
  }

  return {
    authenticated: true,
    telegramUser,
    profileId: profileData.id as string,
    displayName: profileData.display_name as string,
  };
}

// ─── Request context helpers ─────────────────────────────────────────────────

/**
 * Extract Telegram initData from a request.
 *
 * Order: `x-init-data` header first, then the `init_data` field of the JSON body.
 * The request is CLONED before parsing, so the caller can still read the body
 * afterwards. Reading the original body first would make `.clone()` throw
 * ("disturbed" request) and silently lose auth — the root cause of the false
 * 404 "Спринт не найден" on sprint update.
 *
 * Call this ONCE at the top of every handler, before any other body access.
 */
export async function extractInitData(req: Request): Promise<string | undefined> {
  const headerData = req.headers.get('x-init-data');
  if (headerData) return headerData;

  try {
    const body = (await req.clone().json()) as Record<string, unknown> | null;
    const initData = body?.init_data;
    return typeof initData === 'string' ? initData : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tenant isolation: check that the profile is an active member (worker) of the
 * given workspace. Always check membership against the RESOURCE's own
 * workspace_id (e.g. sprint.workspace_id) — never against a "first active
 * worker": users may belong to several workspaces, and `.limit(1)` without a
 * workspace filter is nondeterministic.
 */
export async function isWorkspaceMember(
  profileId: string,
  workspaceId: string,
): Promise<boolean> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('workers')
    .select('id')
    .eq('source_id', profileId)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .limit(1);

  return Array.isArray(data) && data.length > 0;
}

/**
 * All workspace IDs the profile is an active member of, deduplicated.
 * Used when an endpoint needs a default/filtered workspace set — NEVER pick one
 * via `.limit(1)` on a non-deterministic order.
 */
export async function getUserWorkspaceIds(profileId: string): Promise<string[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('workers')
    .select('workspace_id')
    .eq('source_id', profileId)
    .eq('is_active', true);

  return [
    ...new Set((data ?? []).map((w) => w.workspace_id).filter(Boolean)),
  ] as string[];
}