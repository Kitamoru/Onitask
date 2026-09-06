/**
 * viewPreference — localStorage helper for remembering the last active view
 * (stream or flowboard) so the app opens the correct page on next launch.
 *
 * Key: 'onitask_last_view'
 * Values: 'stream' | 'flowboard'
 */

const STORAGE_KEY = 'onitask_last_view';

export type ViewPreference = 'stream' | 'flowboard';

export function getPreferredView(): ViewPreference {
  try {
    const val = window.localStorage.getItem(STORAGE_KEY);
    if (val === 'stream' || val === 'flowboard') return val;
  } catch {
    /* localStorage unavailable */
  }
  return 'flowboard';
}

export function setPreferredView(view: ViewPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    /* non-critical */
  }
}
