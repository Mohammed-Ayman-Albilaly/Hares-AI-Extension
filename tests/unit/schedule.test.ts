import { describe, expect, it } from 'vitest';
import { ensureAlarm, isCheckDue, type AlarmsLike } from '../../src/backend/schedule';

function fakeAlarms(initial: Record<string, number> = {}) {
  const alarms = new Map(Object.entries(initial));
  const created: Array<[string, number]> = [];
  const api: AlarmsLike = {
    get: async (name) => (alarms.has(name) ? { periodInMinutes: alarms.get(name) } : undefined),
    create: async (name, info) => {
      alarms.set(name, info.periodInMinutes);
      created.push([name, info.periodInMinutes]);
    },
  };
  return { api, created };
}

describe('ensureAlarm', () => {
  it('creates a missing alarm', async () => {
    const t = fakeAlarms();
    expect(await ensureAlarm(t.api, 'policy', 5)).toBe(true);
    expect(t.created).toEqual([['policy', 5]]);
  });

  it('leaves a running alarm alone, so a service worker wake-up does not restart its period', async () => {
    const t = fakeAlarms({ policy: 5 });
    for (let wake = 0; wake < 10; wake += 1) expect(await ensureAlarm(t.api, 'policy', 5)).toBe(false);
    expect(t.created).toEqual([]);
  });

  it('replaces an alarm whose period changed (new build)', async () => {
    const t = fakeAlarms({ policy: 30 });
    expect(await ensureAlarm(t.api, 'policy', 5)).toBe(true);
    expect(t.created).toEqual([['policy', 5]]);
  });
});

describe('isCheckDue', () => {
  const NOW = Date.parse('2026-10-29T10:00:00.000Z');
  const FIVE_MIN = 5 * 60_000;

  it('is due when there was no check, or the record is unreadable', () => {
    expect(isCheckDue(undefined, NOW, FIVE_MIN)).toBe(true);
    expect(isCheckDue('not a date', NOW, FIVE_MIN)).toBe(true);
  });

  it('is due once the last check is 5 minutes old, not before', () => {
    expect(isCheckDue('2026-10-29T09:55:01.000Z', NOW, FIVE_MIN)).toBe(false);
    expect(isCheckDue('2026-10-29T09:55:00.000Z', NOW, FIVE_MIN)).toBe(true);
  });
});
