// Регрессия: /task в реплае на ПЕРЕСЛАННОЕ сообщение.
//
// Симптом: бот отвечал «⚠️ Профиль не найден. Начните с /start».
// Причина: актором команды считался reply_to_message.from — а у
// пересланного сообщения это переславший его в чат, а не автор
// оригинала. Бот искал профиль чужого (или несуществующего) человека.
import { describe, it, expect } from 'vitest';
import { resolveActorId } from '../../src/lib/bot/actor';

const BULAT = 338837354; // truebulat — есть профиль
const FORWARDER = 999999999; // переслал сообщение в чат, профиля нет

describe('resolveActorId: актор /task в реплае', () => {
  it('реплай на своё сообщение — актор я', () => {
    expect(
      resolveActorId({
        from: { id: BULAT },
        reply_to_message: { from: { id: BULAT } },
      }),
    ).toBe(BULAT);
  });

  it('реплай на пересланное сообщение — актор я, а не переславший', () => {
    // Регрессия: раньше возвращалось FORWARDER -> «Профиль не найден».
    expect(
      resolveActorId({
        from: { id: BULAT },
        reply_to_message: {
          from: { id: FORWARDER },
          forward_origin: {
            type: 'user',
            sender_user: { id: 111, is_bot: false, first_name: 'Иван' },
            date: 1,
          },
        },
      }),
    ).toBe(BULAT);
  });

  it('реплай на сообщение без from (канал) — актор я', () => {
    expect(
      resolveActorId({
        from: { id: BULAT },
        reply_to_message: {},
      }),
    ).toBe(BULAT);
  });

  it('без реплая — актор я', () => {
    expect(resolveActorId({ from: { id: BULAT } })).toBe(BULAT);
  });

  it('сообщение без отправителя — undefined (канал как from)', () => {
    expect(resolveActorId({})).toBeUndefined();
    expect(
      resolveActorId({ reply_to_message: { from: { id: FORWARDER } } }),
    ).toBeUndefined();
  });
});
