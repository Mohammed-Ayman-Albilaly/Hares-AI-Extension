import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ sendMessage: (async (): Promise<unknown> => undefined) as (...args: unknown[]) => Promise<unknown> }));
vi.mock('wxt/browser', () => ({ browser: { runtime } }));

import { POLICY_FRESH_WAIT_MS, POLICY_MAX_AGE_ON_SEND_MS, POLICY_REFRESH_MINUTES } from '../../src/backend/config';
import { isCheckDue } from '../../src/backend/schedule';
import { MSG, TARGET } from '../../src/messaging/protocol';
import { requestFreshPolicy } from '../../src/policy/fresh';

afterEach(() => vi.useRealTimers());

describe('policy freshness settings', () => {
  it('checks in the background at least every minute, never faster than Chrome allows alarms', () => {
    expect(POLICY_REFRESH_MINUTES).toBeGreaterThanOrEqual(0.5);
    expect(POLICY_REFRESH_MINUTES).toBeLessThanOrEqual(1);
  });

  it('a send re-checks only when the last check is older than 15 seconds', () => {
    const now = Date.parse('2026-10-29T10:00:00.000Z');
    expect(POLICY_MAX_AGE_ON_SEND_MS).toBe(15_000);
    expect(isCheckDue('2026-10-29T09:59:50.000Z', now, POLICY_MAX_AGE_ON_SEND_MS)).toBe(false);
    expect(isCheckDue('2026-10-29T09:59:45.000Z', now, POLICY_MAX_AGE_ON_SEND_MS)).toBe(true);
    expect(POLICY_FRESH_WAIT_MS).toBeLessThan(3000);
  });
});

describe('requestFreshPolicy', () => {
  it('asks the background and returns when it answers', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    runtime.sendMessage = send;
    await requestFreshPolicy();
    expect(send).toHaveBeenCalledWith({ target: TARGET.BACKGROUND, type: MSG.POLICY_FRESH });
  });

  it('never throws when the background cannot be reached', async () => {
    runtime.sendMessage = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    await expect(requestFreshPolicy()).resolves.toBeUndefined();
  });

  it('does not hold the send past its timeout when the background is slow', async () => {
    vi.useFakeTimers();
    runtime.sendMessage = vi.fn(() => new Promise<unknown>(() => undefined));
    let done = false;
    void requestFreshPolicy(2000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });
});
