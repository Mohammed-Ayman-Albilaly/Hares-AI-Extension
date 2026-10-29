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
import { API_BASE_URL, POLICY_REFRESH_MINUTES } from './config';
import { Outbox } from './outbox';
import { createPolicySync } from './policy-sync';
import { Session } from './session';
import { createUploader } from './uploader';

const POLICY_ALARM = 'hares-policy-refresh';
/** Safety net: wakes the service worker to upload what is left if it was stopped mid-way. */
const UPLOAD_ALARM = 'hares-upload';
/** Time allowed to send the queue before signing out. */
const SIGN_OUT_FLUSH_MS = 5000;
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
    if (m.type === MSG.LOG_EVENT) {
      void handleLogEvent(m as LogEventMessage).then(sendResponse);
      return true;
    }
    return;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLICY_ALARM) void syncPolicy();
    if (alarm.name === UPLOAD_ALARM) void flushQuietly();
  });
  // Creating an alarm with an existing name replaces it, so this is safe on every start.
  void browser.alarms.create(POLICY_ALARM, { periodInMinutes: POLICY_REFRESH_MINUTES });
  void browser.alarms.create(UPLOAD_ALARM, { periodInMinutes: 1 });

  void clock.load();
  void browser.storage.local.remove(LEGACY_QUEUE_KEY);

  const onStart = (): void => {
    void syncPolicy();
    void flushQuietly();
  };
  browser.runtime.onStartup.addListener(onStart);
  browser.runtime.onInstalled.addListener(onStart);
}
