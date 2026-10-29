/**
 * Hares AI — the queue of events waiting to be uploaded.
 *
 * Kept in `storage.local` so it survives the service worker being stopped and
 * the browser being closed. At most 500 events: when it is full the oldest is
 * dropped. All access goes through one chain, so two events arriving together
 * (two tabs) cannot overwrite each other.
 */

import { isEventDraft, type EventDraft } from '../logging/event';
import type { KeyValueArea } from './session';

export const OUTBOX_KEY = 'hares.outbox';
export const MAX_QUEUED = 500;

export class Outbox {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: KeyValueArea) {}

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<EventDraft[]> {
    const stored = (await this.area.get(OUTBOX_KEY))[OUTBOX_KEY];
    return Array.isArray(stored) ? stored.filter(isEventDraft) : [];
  }

  /** Add an event at the end. An event already queued (same `log_id`) is not added twice. */
  push(event: EventDraft): Promise<void> {
    return this.run(async () => {
      const queue = await this.read();
      if (queue.some((e) => e.log_id === event.log_id)) return;
      queue.push(event);
      await this.area.set({ [OUTBOX_KEY]: queue.slice(-MAX_QUEUED) });
    });
  }

  /** The oldest event, without removing it. */
  peek(): Promise<EventDraft | null> {
    return this.run(async () => (await this.read())[0] ?? null);
  }

  remove(logId: string): Promise<void> {
    return this.run(async () => {
      const queue = await this.read();
      const rest = queue.filter((e) => e.log_id !== logId);
      if (rest.length !== queue.length) await this.area.set({ [OUTBOX_KEY]: rest });
    });
  }

  size(): Promise<number> {
    return this.run(async () => (await this.read()).length);
  }

  clear(): Promise<void> {
    return this.run(() => this.area.remove(OUTBOX_KEY));
  }
}
