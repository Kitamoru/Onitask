// src/lib/bot/replySource.ts — извлечение текста для `/task` в реплае.
//
// bot.md §5.1.4: источник сырого текста — не `message.text` (это сам
// `/task`), а тело процитированного сообщения. Приоритет:
//
//   quote.text → reply_to_message.text → reply_to_message.caption
//
// Почему не только `.text` (как было раньше):
//   - фото/файл/видео с подписью отдают текст в `caption`, а `.text` пуст;
//   - у пересланного сообщения из канала с защитой контента Telegram не
//     отдаёт боту тело вообще — ни `.text`, ни `.caption`.
//
// `quote` идёт первым: Quote & Reply — это осознанный выбор
// пользователем выделенного фрагмента, он точнее целого сообщения.
// Доставка `quote` в публичных группах была нестабильной (issue в
// tdlib, 2023); деградация безопасная — при отсутствии `quote` берётся
// тело сообщения целиком.
//
// Вынесено в отдельный модуль по той же причине, что и actor.ts:
// dispatchUpdate — Route Handler с побочными эффектами, в vitest не
// тестируется.

/** Минимальный набор полей сообщения, нужный для извлечения текста */
export interface ReplySourceMessage {
  text?: string;
  caption?: string;
  quote?: { text?: string; position?: number; is_manual?: boolean };
  voice?: { file_id: string };
  photo?: unknown;
  document?: unknown;
  video?: unknown;
  audio?: unknown;
  animation?: unknown;
}

export interface ReplySource {
  /** Текст для постановки задачи; '' если текста взять неоткуда */
  text: string;
  /** Откуда взят текст — для диагностики и логов */
  origin: 'quote' | 'text' | 'caption' | 'voice' | 'none';
  /** file_id голосового в реплае → пайплайн STT (§5.1.1) */
  voiceFileId?: string;
  /** Тело сообщения недоступно боту (защита контента в канале) */
  protectedContent: boolean;
  /** В реплае медиа без текстовой подписи */
  mediaWithoutText: boolean;
}

const MEDIA_KEYS = [
  'photo',
  'document',
  'video',
  'audio',
  'animation',
] as const;

/**
 * Достать текст для `/task` в реплае.
 *
 * `null` вместо сообщения означает, что реплая нет — тогда вызывающий
 * работает с аргументами команды как обычно.
 */
export function extractReplySource(
  message: ReplySourceMessage | null | undefined,
): ReplySource | null {
  if (!message) return null;

  const quote = message.quote?.text?.trim();
  if (quote) {
    return {
      text: quote,
      origin: 'quote',
      protectedContent: false,
      mediaWithoutText: false,
    };
  }

  const body = message.text?.trim();
  if (body) {
    return {
      text: body,
      origin: 'text',
      protectedContent: false,
      mediaWithoutText: false,
    };
  }

  // Подпись к медиа: Telegram отдаёт текст сюда, а не в .text
  const caption = message.caption?.trim();
  if (caption) {
    return {
      text: caption,
      origin: 'caption',
      protectedContent: false,
      mediaWithoutText: false,
    };
  }

  if (message.voice?.file_id) {
    return {
      text: '',
      origin: 'voice',
      voiceFileId: message.voice.file_id,
      protectedContent: false,
      mediaWithoutText: true,
    };
  }

  const hasMedia = MEDIA_KEYS.some((key) => Boolean(message[key]));
  // Тело есть, Telegram его не прислал: защищённый контент в канале.
  // Отличаем от медиа без подписи — сообщение об ошибке должно различать
  // эти случаи, иначе пользователю предлагается бессмысленно прислать
  // текст заново.
  const protectedContent = !hasMedia;

  return {
    text: '',
    origin: 'none',
    protectedContent,
    mediaWithoutText: hasMedia,
  };
}
