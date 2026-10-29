/**
 * Hares AI — keep the periodic alarms alive without resetting them.
 *
 * `alarms.create` with an existing name REPLACES that alarm and restarts its
 * period. The service worker runs this setup every time it wakes, and it wakes
 * for every message from a page, so creating the alarm unconditionally pushed
 * the next policy check back each time and, with regular use, it never fired.
 * An alarm is therefore created only when it is missing or has another period.
 */

export interface AlarmsLike {
  get(name: string): Promise<{ periodInMinutes?: number } | undefined>;
  create(name: string, info: { periodInMinutes: number }): Promise<void> | void;
}

/** Make sure the alarm exists with this period. Returns true if it had to be created. */
export async function ensureAlarm(alarms: AlarmsLike, name: string, periodInMinutes: number): Promise<boolean> {
  const existing = await alarms.get(name);
  if (existing && existing.periodInMinutes === periodInMinutes) return false;
  await alarms.create(name, { periodInMinutes });
  return true;
}

/** Whether the last check is older than `maxAgeMs` (or there was none). */
export function isCheckDue(lastAttemptAt: unknown, now: number, maxAgeMs: number): boolean {
  if (typeof lastAttemptAt !== 'string') return true;
  const at = Date.parse(lastAttemptAt);
  return Number.isNaN(at) || now - at >= maxAgeMs;
}
