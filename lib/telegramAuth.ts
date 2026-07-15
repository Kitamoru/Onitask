// validateTelegramInitData — Telegram Web App initData validation
// Uses HMAC-SHA256 + timingSafeEqual (axiom A-2: Timing Safe & DB Isolation)
// Works in both Node.js and Deno Edge Runtime (Vercel)

import { webcrypto } from 'node:crypto';

export interface TelegramUser {
  id: string;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code: string;
}

export interface ValidateResult {
  valid: boolean;
  user?: TelegramUser;
  error?: string;
}

/**
 * Validates Telegram initData string using HMAC-SHA256.
 * 
 * Algorithm (per Telegram Bot API docs):
 * 1. Parse initData into key=value pairs
 * 2. Exclude the hash parameter
 * 3. Sort remaining params alphabetically by key
 * 4. Join with newline: "key=value\nkey2=value2\n..."
 * 5. Compute HMAC-SHA256(botToken, dataToCheck)
 * 6. Compare computed hex hash with provided hash using timingSafeEqual
 * 7. Verify auth_date is not older than 24 hours
 */
export async function validateTelegramInitData(
  initData: string,
  botToken: string,
): Promise<ValidateResult> {
  if (!initData || !botToken) {
    return { valid: false, error: 'missing_params' };
  }

  try {
    // Parse initData into a map
    const params = new Map<string, string>();
    const pairs = initData.split('&');

    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        params.set(key, valueParts.join('='));
      }
    }

    // Extract and remove hash
    const providedHash = params.get('hash');
    if (!providedHash) {
      return { valid: false, error: 'missing_hash' };
    }
    params.delete('hash');

    // Check auth_date expiration (24 hours = 86400 seconds)
    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      return { valid: false, error: 'missing_auth_date' };
    }

    const authDate = parseInt(authDateStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      return { valid: false, error: 'expired_init_data' };
    }

    // Build dataToCheck: sorted key=value pairs joined by newline
    const sortedKeys = Array.from(params.keys()).sort();
    const dataToCheck = sortedKeys
      .map((key) => `${key}=${params.get(key)}`)
      .join('\n');

    // Compute HMAC-SHA256
    const encoder = new TextEncoder();
    const keyMaterial = await webcrypto.subtle.importKey(
      'raw',
      encoder.encode(botToken),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature = await webcrypto.subtle.sign(
      'HMAC',
      keyMaterial,
      encoder.encode(dataToCheck),
    );

    // Convert to hex string
    const computedHash = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Timing-safe comparison
    const providedHashBytes = encoder.encode(providedHash);
    const computedHashBytes = encoder.encode(computedHash);

    if (providedHashBytes.length !== computedHashBytes.length) {
      return { valid: false, error: 'invalid_hash' };
    }

    let result = 0;
    for (let i = 0; i < providedHashBytes.length; i++) {
      result |= providedHashBytes[i] ^ computedHashBytes[i];
    }

    if (result !== 0) {
      return { valid: false, error: 'invalid_hash' };
    }

    // Extract user info if present
    const userJson = params.get('user');
    let user: TelegramUser | undefined;

    if (userJson) {
      try {
        const userData = JSON.parse(userJson);
        user = {
          id: String(userData.id),
          is_bot: userData.is_bot || false,
          first_name: userData.first_name || '',
          last_name: userData.last_name,
          username: userData.username,
          language_code: userData.language_code || 'en',
        };
      } catch {
        // User data is optional for validation
      }
    }

    return { valid: true, user };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'validation_error',
    };
  }
}