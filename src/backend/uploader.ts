/**
 * Hares AI — upload queued events with `POST /logs`, one at a time.
 *
 * - 201 / 200 (a duplicate counts once on the server): the event leaves the queue.
 * - Every retry sends the same `log_id`, so a retry after a lost answer is safe.
 * - 429: wait for `Retry-After`. 5xx or offline: back off (2 s, doubling, up to
 *   5 min) and try again later.
 * - 400 (and other 4xx): the event would fail every time, so it is dropped.
 * - 403 DEPARTMENT_INACTIVE: stop uploading, keep the queue, and try again after
 *   the next successful policy check. The user stays signed in.
 * - 401: the session layer refreshes once or ends the session; either way this
 *   loop stops when the user is no longer signed in.
 * - Events older than 89 days are dropped before sending (the server refuses 90).
 *
 * Sends are spaced out, so the 120-per-minute limit is never reached.
 */

import { toLogEvent, type EventDraft } from '../logging/event';
import { ApiError } from './api';
import type { ServerClock } from './clock';
import type { Outbox } from './outbox';
import type { KeyValueArea, Session } from './session';

export const UPLOAD_STATE_KEY = 'hares.uploadState';
export const UPLOAD_SPACING_MS = 1000;
export const MAX_EVENT_AGE_MS = 89 * 24 * 60 * 60 * 1000;
export const BACKOFF_START_MS = 2000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;

export interface UploadState {
  /** Uploads are paused until the next policy check (DEPARTMENT_INACTIVE). */
  paused: boolean;
  /** Epoch ms before which nothing is sent (backoff, Retry-After). */
  nextAttemptAt: number;
  /** Consecutive transient failures, for the backoff. */
  attempts: number;
}

export interface UploaderDeps {
  session: Session;
  outbox: Outbox;
  clock: ServerClock;
  state: KeyValueArea;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Ask for another `flush` after `delayMs` (the caller decides how). */
  schedule?: (delayMs: number) => void;
}

export interface Uploader {
  /** Send what is queued. `maxMs` bounds the time spent (used before signing out). */
  flush(options?: { maxMs?: number }): Promise<void>;
  /** A policy check succeeded: uploads paused by DEPARTMENT_INACTIVE may try again. */
  resume(): Promise<void>;
  /** Forget the upload state (on sign-out). */
  reset(): Promise<void>;
}

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempts - 1));
}

export function createUploader(deps: UploaderDeps): Uploader {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let running: Promise<void> | null = null;

  async function readState(): Promise<UploadState> {
    const stored = (await deps.state.get(UPLOAD_STATE_KEY))[UPLOAD_STATE_KEY] as Partial<UploadState> | undefined;
    return {
      paused: stored?.paused === true,
      nextAttemptAt: typeof stored?.nextAttemptAt === 'number' ? stored.nextAttemptAt : 0,
      attempts: typeof stored?.attempts === 'number' ? stored.attempts : 0,
    };
  }

  const writeState = (state: UploadState): Promise<void> => deps.state.set({ [UPLOAD_STATE_KEY]: state });

  /** Send one event. Returns false when the loop should stop. */
  async function sendOne(event: EventDraft, state: UploadState): Promise<boolean> {
    if (now() - event.occurred_at > MAX_EVENT_AGE_MS) {
      await deps.outbox.remove(event.log_id);
      return true;
    }
    try {
      await deps.session.request('/logs', { method: 'POST', json: toLogEvent(event, deps.clock.offsetMs) });
      await deps.outbox.remove(event.log_id);
      if (state.attempts !== 0 || state.nextAttemptAt !== 0) await writeState({ ...state, attempts: 0, nextAttemptAt: 0 });
      return true;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (!(await deps.session.isSignedIn())) return false; // the session ended; sign-out clears the queue

      if (error.status === 429) {
        const wait = Math.max(1, error.retryAfterSeconds ?? 60) * 1000;
        await writeState({ ...state, nextAttemptAt: now() + wait });
        deps.schedule?.(wait);
        return false;
      }
      if (error.status === 403 && error.code === 'DEPARTMENT_INACTIVE') {
        await writeState({ ...state, paused: true });
        return false;
      }
      if (error.status === 0 || error.status >= 500 || error.status === 408) {
        const attempts = state.attempts + 1;
        const wait = backoffMs(attempts);
        await writeState({ ...state, attempts, nextAttemptAt: now() + wait });
        deps.schedule?.(wait);
        return false;
      }
      // 400 and other client errors: retrying cannot help. Only codes are logged, never the event.
      console.warn(`[hares] event dropped: ${error.status} ${error.code} (request ${error.requestId ?? 'n/a'})`);
      await deps.outbox.remove(event.log_id);
      return true;
    }
  }

  async function run(maxMs: number | undefined): Promise<void> {
    const deadline = maxMs === undefined ? Number.POSITIVE_INFINITY : now() + maxMs;
    for (;;) {
      if (!(await deps.session.isSignedIn())) return;
      const state = await readState();
      if (state.paused || state.nextAttemptAt > now()) return;
      const event = await deps.outbox.peek();
      if (!event) return;
      if (!(await sendOne(event, state))) return;
      if ((await deps.outbox.size()) === 0 || now() + UPLOAD_SPACING_MS >= deadline) return;
      await sleep(UPLOAD_SPACING_MS);
    }
  }

  return {
    flush(options) {
      running ??= run(options?.maxMs).finally(() => {
        running = null;
      });
      return running;
    },
    async resume() {
      const state = await readState();
      if (state.paused) await writeState({ ...state, paused: false });
      await this.flush();
    },
    reset() {
      return deps.state.remove(UPLOAD_STATE_KEY);
    },
  };
}
