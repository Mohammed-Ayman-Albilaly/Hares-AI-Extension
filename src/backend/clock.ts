/**
 * Hares AI — the server's clock, for `event_time`.
 *
 * The backend rejects an event more than 5 minutes in the future or 90 days
 * old, so a wrong device clock would lose events. The `Date` header of every
 * answer tells how far the device is from the server; events are stamped with
 * the device time plus that offset. Until the first answer, the device clock is
 * used as is.
 */

import type { KeyValueArea } from './session';

export const CLOCK_OFFSET_KEY = 'hares.clockOffsetMs';

/**
 * Below this, the difference is the header's one-second resolution and network
 * delay, not a wrong clock, so it is ignored.
 */
export const CLOCK_DEADBAND_MS = 2000;

export class ServerClock {
  private offset = 0;

  constructor(
    private readonly area?: KeyValueArea,
    private readonly now: () => number = Date.now,
  ) {}

  /** Restore the offset learned before the service worker was last stopped. */
  async load(): Promise<void> {
    const stored = (await this.area?.get(CLOCK_OFFSET_KEY))?.[CLOCK_OFFSET_KEY];
    if (typeof stored === 'number' && Number.isFinite(stored)) this.offset = stored;
  }

  /** Learn the offset from a response's `Date` header. */
  observe(dateHeader: string): void {
    const server = Date.parse(dateHeader);
    if (Number.isNaN(server)) return;
    const diff = server - this.now();
    const next = Math.abs(diff) < CLOCK_DEADBAND_MS ? 0 : diff;
    if (next === this.offset) return;
    this.offset = next;
    void this.area?.set({ [CLOCK_OFFSET_KEY]: next }).catch(() => undefined);
  }

  /** Server time minus device time, in ms. */
  get offsetMs(): number {
    return this.offset;
  }
}
