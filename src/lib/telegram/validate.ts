// validateTelegramInitData — Telegram Web App initData validation
// Uses HMAC-SHA256 + timingSafeEqual (axiom A-2: Timing Safe & DB Isolation)
// Works in both Node.js and Deno Edge Runtime (Vercel)
//
// Algorithm per Telegram Bot API docs:
// 1. Parse initData into key=value pairs
// 2. Exclude the hash parameter
// 3. Sort remaining params alphabetically by key
// 4. Join with newline: "key=value\nkey2=value2\n..."
// 5. Derive secret key: HMAC_SHA256('WebAppData', botToken)
// 6. Compute HMAC-SHA256(secretKey, dataToCheck)
// 7. Compare computed hex hash with provided hash using timingSafeEqual
// 8. Verify auth_date is not older than 24 hours

import crypto from 'crypto';

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
 * Derives the secret key for Telegram initData validation.
 * Per Telegram spec: secretKey = HMAC_SHA256('WebAppData', botToken)
 */
function deriveSecretKey(botToken: string): Buffer {
  return crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/**
 * Performs a timing-safe comparison of two strings.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }

  return result === 0;
}

/**
 * Validates Telegram initData string using HMAC-SHA256.
 *
 * Algorithm (per Telegram Bot API docs):
 * 1. Parse initData into key=value pairs
 * 2. Exclude the hash parameter
 * 3. Sort remaining params alphabetically by key
 * 4. Join with newline: "key=value\nkey2=value2\n..."
 * 5. Derive secret key: HMAC_SHA256('WebAppData', botToken)
 * 6. Compute HMAC-SHA256(secretKey, dataToCheck)
 * 7. Compare computed hex hash with provided hash using timingSafeEqual
 * 8. Verify auth_date is not older than 24 hours
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
): ValidateResult {
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
        params.set(key, decodeURIComponent(valueParts.join('=')));
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

    // Derive secret key: HMAC_SHA256('WebAppData', botToken)
    const secretKey = deriveSecretKey(botToken);

    // Compute HMAC-SHA256(secretKey, dataToCheck)
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(dataToCheck);
    const computedHash = hmac.digest('hex');

    // Timing-safe comparison
    if (!timingSafeEqual(providedHash, computedHash)) {
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