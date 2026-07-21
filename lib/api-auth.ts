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

import { validateTelegramInitData } from './telegramAuth';
import { createServerClient } from './supabase';
import type { TelegramUser } from './telegramAuth';

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