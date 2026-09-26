/**
 * avatarCache — localStorage helper caching the user's own Telegram avatar
 * between Mini App launches.
 *
 * Why this exists: `initDataUnsafe.user.photo_url` points at Telegram's CDN
 * (`https://t.me/i/userpic/<size>/<random-hash>/<session>/<n>`) and the hash is
 * regenerated on every session. The browser HTTP cache therefore NEVER hits —
 * each launch re-downloads the image from scratch. Storing the decoded bytes
 * ourselves makes every launch after the first paint instantly.
 *
 * Cache lives only in the device's localStorage. Nothing is written server-side:
 * `profiles.avatar_url` stays NULL by design (INV-16 — no auto-update of
 * display_name/avatar_url).
 *
 * Key: 'onitask_avatar_<telegram_id>'
 * Value: JSON { dataUrl, savedAt }
 */

/** How long a cached avatar is served without hitting the network. */
export const AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Above this raw size we skip the cache entirely: a base64 data-URL would cost
 * ~1.3x the bytes in a ~5 MB localStorage quota while being no cheaper to
 * paint than the plain CDN URL. Telegram's 104px userpic is orders of magnitude
 * below this, so in practice the branch never triggers.
 */
export const AVATAR_MAX_BYTES = 500 * 1024;

const KEY_PREFIX = 'onitask_avatar_';

interface CachedAvatar {
  dataUrl: string;
  savedAt: number;
}

function storageKey(telegramId: string): string {
  return `${KEY_PREFIX}${telegramId}`;
}

/**
 * Returns the cached data-URL if present and not expired, otherwise null.
 * Never throws — private mode / disabled storage degrades to "no cache".
 */
export function readCachedAvatar(telegramId: string): string | null {
  try {
    const raw = window.localStorage.getItem(storageKey(telegramId));
    if (!raw) return null;

    const entry = JSON.parse(raw) as CachedAvatar;
    if (typeof entry?.dataUrl !== 'string' || typeof entry?.savedAt !== 'number') {
      return null;
    }
    if (Date.now() - entry.savedAt > AVATAR_TTL_MS) return null;
    return entry.dataUrl;
  } catch {
    /* localStorage unavailable or corrupt entry — treat as a miss */
    return null;
  }
}

/** Stores the avatar, replacing any previous entry. Never throws. */
export function writeCachedAvatar(telegramId: string, dataUrl: string): void {
  try {
    const entry: CachedAvatar = { dataUrl, savedAt: Date.now() };
    window.localStorage.setItem(storageKey(telegramId), JSON.stringify(entry));
  } catch {
    /* non-critical: the image is already on screen, it just won't persist */
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (typeof FileReader === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads the avatar and converts it to a data-URL so it can be both painted
 * and persisted. Resolves null on any failure (offline, CORS, oversized) — the
 * caller then keeps showing the letter placeholder.
 */
export async function fetchAvatarAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (blob.size > AVATAR_MAX_BYTES) return null;

    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}