// Регрессия: `/task` в реплае на пересланное сообщение.
//
// Симптом: бот отвечал «Для создания задачи пришлите текст», хотя
// сообщение было. Причина: webhook читал только reply_to_message.text,
// а у пересланного сообщения и у медиа с подписью текст лежит в других
// полях (caption) либо не отдаётся вовсе (защита контента в канале).
import { describe, it, expect } from 'vitest';
import { extractReplySource } from '../../src/lib/bot/replySource';

describe('extractReplySource: текст для /task в реплае', () => {
  it('обычный текст в реплае', () => {
    const r = extractReplySource({ text: 'Починить ленту' });
    expect(r).toMatchObject({ text: 'Починить ленту', origin: 'text' });
  });

  it('реплай на пересланное сообщение с текстом', () => {
    const r = extractReplySource({
      text: 'Пресвятые пончики',
      forward_origin: {
        type: 'user',
        sender_user: { id: 111, is_bot: false, first_name: 'Иван' },
        date: 1,
      },
    } as never);
    expect(r).toMatchObject({ text: 'Пресвятые пончики', origin: 'text' });
  });

  it('фото с подписью — текст берётся из caption (регрессия)', () => {
    // Раньше читался только .text, он здесь пуст -> «пришлите текст».
    const r = extractReplySource({ photo: [{ file_id: 'x' }], caption: 'Скинуть отчёт' });
    expect(r).toMatchObject({ text: 'Скинуть отчёт', origin: 'caption' });
  });

  it('Quote & Reply важнее тела сообщения', () => {
    const r = extractReplySource({
      text: 'Очень длинное сообщение целиком',
      quote: { text: 'выделенный фрагмент', position: 0 },
    });
    expect(r).toMatchObject({ text: 'выделенный фрагмент', origin: 'quote' });
  });

  it('защита контента: тело есть, текста нет — не медиа', () => {
    const r = extractReplySource({
      forward_origin: { type: 'channel', chat: { id: 1, type: 'channel' }, message_id: 5, date: 1 },
    } as never);
    expect(r).toMatchObject({ text: '', origin: 'none', protectedContent: true });
  });

  it('медиа без подписи — это не защита контента', () => {
    // Различие важно: в этом случае пользователю есть что прислать.
    const r = extractReplySource({ photo: [{ file_id: 'x' }] });
    expect(r).toMatchObject({
      text: '',
      origin: 'none',
      protectedContent: false,
      mediaWithoutText: true,
    });
  });

  it('голосовое в реплае — возвращается file_id для STT', () => {
    const r = extractReplySource({ voice: { file_id: 'voice-1' } });
    expect(r).toMatchObject({ text: '', origin: 'voice', voiceFileId: 'voice-1' });
  });

  it('пустая строка и пробелы считаются отсутствием текста', () => {
    expect(extractReplySource({ text: '   ' })).toMatchObject({ origin: 'none' });
    expect(extractReplySource({ text: '', caption: '  ' })).toMatchObject({ origin: 'none' });
  });

  it('нет реплая — null, вызывающий работает с аргументами команды', () => {
    expect(extractReplySource(null)).toBeNull();
    expect(extractReplySource(undefined)).toBeNull();
  });
});
