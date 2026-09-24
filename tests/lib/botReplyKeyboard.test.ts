import { describe, it, expect } from 'vitest';
import { buildCommandReplyKeyboard } from '../../lib/bot';

describe('buildCommandReplyKeyboard', () => {
  it(
    'builds a persistent two-row keyboard for supported primary commands',
    () => {
      expect(buildCommandReplyKeyboard()).toEqual({
        keyboard: [
          [
            { text: '/task' },
            { text: '/call' },
          ],
          [
            { text: '/backlog' },
            { text: '/help' },
          ],
        ],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
      });
    }
  );
});
