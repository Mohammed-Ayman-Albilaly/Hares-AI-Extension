import { describe, expect, it } from 'vitest';
import { createThrottle } from '../../src/runtime/throttle';
import { TOPICS_TIMEOUT_MS } from '../../src/topics/client';

describe('createThrottle', () => {
  it('is ready the first time, then only after the interval', () => {
    let now = 1_000;
    const t = createThrottle(60_000, () => now);
    expect(t.ready()).toBe(true);
    expect(t.ready()).toBe(false);
    now += 59_999;
    expect(t.ready()).toBe(false);
    now += 1;
    expect(t.ready()).toBe(true);
    expect(t.ready()).toBe(false);
  });

  it('touch counts the work as just done: typing right after a send does not warm up again', () => {
    let now = 0;
    const t = createThrottle(60_000, () => now);
    now = 500_000;
    t.touch();
    now += 30_000;
    expect(t.ready()).toBe(false);
    now += 30_000;
    expect(t.ready()).toBe(true);
  });
});

describe('topic time limit', () => {
  it('leaves room above the 1 to 2 seconds measured in Chrome, without holding a send for long', () => {
    expect(TOPICS_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(TOPICS_TIMEOUT_MS).toBeLessThanOrEqual(8000);
  });
});
