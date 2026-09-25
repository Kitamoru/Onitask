import { describe, expect, it } from 'vitest';
import { scrollFeedToLatest } from '../../src/lib/commentsScroll';

describe('scrollFeedToLatest', () => {
  it('прокручивает ленту к нижней границе', () => {
    const element = { scrollHeight: 1840, scrollTop: 0 };
    scrollFeedToLatest(element);
    expect(element.scrollTop).toBe(1840);
  });

  it('без ref ничего не делает', () => {
    expect(() => scrollFeedToLatest(null)).not.toThrow();
  });
});
