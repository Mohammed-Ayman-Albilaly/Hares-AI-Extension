/**
 * Hares AI — backend integration inside the background service worker.
 *
 * Wires the session, the policy sync, the event queue and its uploader, and the
 * messages from the popup and the content scripts to the browser APIs. All
 * calls to the API are made from here, never from a content script.
 */

import { browser } from 'wxt/browser';
import { isEventDraft } from '../logging/event';
import {
  MSG,
  TARGET,
  type AuthLoginRequest,
  type AuthResponse,
  type LogEventMessage,
} from '../messaging/protocol';
import {
  clearPolicy,
  POLICY_ETAG_KEY,
  POLICY_FETCHED_AT_KEY,
  POLICY_KEY,
  replacePolicy,
} from '../policy/store';
import { ApiError } from './api';
import { ServerClock } from './clock';
import { API_BASE_URL, POLICY_FRESH_WAIT_MS, POLICY_MAX_AGE_ON_SEND_MS, POLICY_REFRESH_MINUTES } from './config';
import { Outbox } from './outbox';
import { createPolicySync, type SyncAttempt } from './policy-sync';
import { ensureAlarm, isCheckDue } from './schedule';
import { Session } from './session';
import { createUploader } from './uploader';

const POLICY_ALARM = 'hares-policy-refresh';
/** Safety net: wakes the service worker to upload what is left if it was stopped mid-way. */
const UPLOAD_ALARM = 'hares-upload';
/** Time allowed to send the queue before signing out. */
const SIGN_OUT_FLUSH_MS = 5000;
/** Result of the latest policy check (any outcome), kept to catch up after a missed alarm. */
export const POLICY_CHECK_KEY = 'hares.policyCheck';
/** A check older than this is run when the service worker wakes, in case its alarm was missed. */
const POLICY_STALE_MS = POLICY_REFRESH_MINUTES * 60_000;
/** The queue of an earlier version, before events were uploaded. */
const LEGACY_QUEUE_KEY = 'hares.logQueue';

export const clock = new ServerClock(browser.storage.local);

export const session = new Session({
  api: { baseUrl: API_BASE_URL, fetch: (input, init) => fetch(input, init), onServerDate: (date) => clock.observe(date) },
  local: browser.storage.local,
  session: browser.storage.session,
});

export const outbox = new Outbox(browser.storage.local);

export const uploader = createUploader({
  session,
  outbox,
  clock,
  state: browser.storage.local,
  schedule: (delayMs) => {
    setTimeout(() => void flushQuietly(), delayMs);
  },
});

export const syncPolicy = createPolicySync({
  session,
  async getEtag() {
    // An ETag without a stored policy would answer 304 with nothing to use.
    const stored = await browser.storage.local.get([POLICY_KEY, POLICY_ETAG_KEY]);
    const etag = stored[POLICY_ETAG_KEY];
    return stored[POLICY_KEY] && typeof etag === 'string' ? etag : null;
  },
  save: (policy, etag) => replacePolicy(policy, etag),
  async onAttempt(attempt: SyncAttempt) {
    const record = { at: new Date(attempt.at).toISOString(), result: attempt.result, status: attempt.status, etag: attempt.etag };
    console.info(`[hares] policy check: HTTP ${attempt.status ?? '-'} ${attempt.result} (ETag ${attempt.etag ?? 'none'})`);
    await browser.storage.local.set({ [POLICY_CHECK_KEY]: record });
  },
  async onChecked() {
    await browser.storage.local.set({ [POLICY_FETCHED_AT_KEY]: new Date().toISOString() });
    // A successful check is when uploads paused by DEPARTMENT_INACTIVE try again.
    await uploader.resume().catch(() => undefined);
  },
});

function flushQuietly(): Promise<void> {
  return uploader.flush().catch((error: unknown) => {
    console.warn('[hares] upload failed:', error instanceof Error ? error.message : error);
  });
}

/** Check the policy now if the last check is older than `maxAgeMs`. */
async function syncPolicyIfOlderThan(maxAgeMs: number): Promise<void> {
  const stored = await browser.storage.local.get(POLICY_CHECK_KEY);
  const last = (stored[POLICY_CHECK_KEY] as { at?: unknown } | undefined)?.at;
  if (isCheckDue(last, Date.now(), maxAgeMs)) await syncPolicy();
}

/** Before a message is scanned: a recent check is enough, an old one is redone (briefly waited for). */
async function ensureFreshPolicy(): Promise<{ ok: boolean }> {
  if (!(await session.isSignedIn())) return { ok: true };
  const wait = new Promise<void>((resolve) => setTimeout(resolve, POLICY_FRESH_WAIT_MS));
  await Promise.race([syncPolicyIfOlderThan(POLICY_MAX_AGE_ON_SEND_MS), wait]).catch(() => undefined);
  return { ok: true };
}

function failure(error: unknown): AuthResponse {
  if (error instanceof ApiError) {
    return { ok: false, code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds };
  }
  return { ok: false, code: 'UNKNOWN', message: 'Something went wrong' };
}

async function handleLogin(request: AuthLoginRequest): Promise<AuthResponse> {
  try {
    await session.login(request.email, request.password);
    void syncPolicy();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

async function handleLogout(): Promise<AuthResponse> {
  try {
    // Events that were waiting belong to this user: send them while the token still works.
    await uploader.flush({ maxMs: SIGN_OUT_FLUSH_MS }).catch(() => undefined);
    await session.logout();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Queue an event from a page, but only for a signed-in user. */
async function handleLogEvent(message: LogEventMessage): Promise<{ ok: boolean }> {
  if (!isEventDraft(message.event) || !(await session.isSignedIn())) return { ok: false };
  await outbox.push(message.event);
  void flushQuietly();
  return { ok: true };
}

export function installBackend(): void {
  // Leaving the session (sign-out, expiry, deactivation) drops what belongs to
  // that user: their policy, and events not yet sent. The next user must not
  // run under the policy or upload under the token of the one before.
  session.onSignedOut(async () => {
    await Promise.all([clearPolicy(), outbox.clear(), uploader.reset()]);
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const m = message as { target?: string; type?: string } | undefined;
    if (m?.target !== TARGET.BACKGROUND) return;
    if (m.type === MSG.AUTH_LOGIN) {
      void handleLogin(m as AuthLoginRequest).then(sendResponse);
      return true;
    }
    if (m.type === MSG.AUTH_LOGOUT) {
      void handleLogout().then(sendResponse);
      return true;
    }
    if (m.type === MSG.POLICY_FRESH) {
      void ensureFreshPolicy().then(sendResponse);
      return true;
    }
    if (m.type === MSG.LOG_EVENT) {
      handleLogEvent(m as LogEventMessage)
        .catch((error: unknown) => {
          console.warn('[hares] could not queue the event:', error instanceof Error ? error.message : error);
          return { ok: false };
        })
        .then(sendResponse);
      return true;
    }
    return;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    console.info(`[hares] alarm fired: ${alarm.name}`);
    if (alarm.name === POLICY_ALARM) void syncPolicy();
    if (alarm.name === UPLOAD_ALARM) void flushQuietly();
  });
  // Alarms survive the service worker being stopped, but not always a browser
  // restart. Create them when missing; never re-create a running one, which
  // would restart its period on every wake-up.
  const alarmsApi = {
    get: (name: string) => browser.alarms.get(name),
    create: (name: string, info: { periodInMinutes: number }) => browser.alarms.create(name, info),
  };
  void Promise.all([
    ensureAlarm(alarmsApi, POLICY_ALARM, POLICY_REFRESH_MINUTES),
    ensureAlarm(alarmsApi, UPLOAD_ALARM, 1),
  ])
    .then(([policyCreated]) => console.info(`[hares] alarms ready (policy alarm ${policyCreated ? 'created' : 'already running'})`))
    .catch((error: unknown) => console.warn('[hares] could not set up alarms:', error instanceof Error ? error.message : error));

  // If an alarm was missed (browser asleep, worker killed), catch up on wake-up.
  void syncPolicyIfOlderThan(POLICY_STALE_MS).catch(() => undefined);

  void clock.load().catch(() => undefined);
  void browser.storage.local.remove(LEGACY_QUEUE_KEY).catch(() => undefined);

  const onStart = (): void => {
    void syncPolicy();
    void flushQuietly();
  };
  browser.runtime.onStartup.addListener(onStart);
  browser.runtime.onInstalled.addListener(onStart);
}
