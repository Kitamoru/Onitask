// lib/shared/downloadToken.ts
// FILE-10: capability-токен для скачивания файла задачи через прокси-роут
// (/api/tasks/[id]/attachments/[attachmentId]/file).
//
// Зачем: Telegram.WebApp.downloadFile делает нативный HTTP-запрос сам (вне webview)
// и не может нести авторизационные заголовки — URL обязан быть самоавторизующимся.
// Токен = HMAC-SHA256(серверный секрет, taskId|attachmentId|exp) — подделка невозможна,
// scope жёстко привязан к конкретному файлу, TTL 5 минут (потребляется сразу после клика).
//
// Выдача токена — только через POST [attachmentId] (initData + isWorkspaceMember).

import crypto from 'crypto';

/** Токен живёт 5 минут — его чеканят в момент клика и потребляют мгновенно. */
export const ATTACHMENT_DOWNLOAD_TOKEN_TTL = 300;

function hmacSecret(): string {
  // server-only секрет (никогда не попадает в клиентский бандл)
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function tokenSignature(taskId: string, attachmentId: string, exp: number): string {
  return crypto
    .createHmac('sha256', hmacSecret())
    .update(`${taskId}:${attachmentId}:${exp}`)
    .digest('hex');
}

/** Чеканит токен: `<exp>:<hmac-hex>` — scope зашит в подпись. */
export function mintAttachmentDownloadToken(
  taskId: string,
  attachmentId: string,
): string {
  const exp = Math.floor(Date.now() / 1000) + ATTACHMENT_DOWNLOAD_TOKEN_TTL;
  return `${exp}:${tokenSignature(taskId, attachmentId, exp)}`;
}

/** Проверка: подпись (timing-safe), срок жизни, scope (taskId + attachmentId). */
export function verifyAttachmentDownloadToken(
  token: string | null | undefined,
  taskId: string,
  attachmentId: string,
): boolean {
  if (!token || !hmacSecret()) return false;
  const separator = token.indexOf(':');
  if (separator <= 0) return false;
  const exp = Number(token.slice(0, separator));
  const sig = token.slice(separator + 1);
  if (!Number.isFinite(exp) || !sig) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expected = tokenSignature(taskId, attachmentId, exp);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
