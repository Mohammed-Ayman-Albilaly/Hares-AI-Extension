/**
 * Hares AI — backend integration inside the background service worker.
 *
 * Wires the session, the policy sync and the sign-in messages from the popup to
 * the browser APIs. All calls to the API are made from here, never from a
 * content script.
 */

import { browser } from 'wxt/browser';
import {
  MSG,
  TARGET,
  type AuthLoginRequest,
  type AuthResponse,
} from '../messaging/protocol';
import {
  clearPolicy,
  POLICY_ETAG_KEY,
  POLICY_FETCHED_AT_KEY,
  POLICY_KEY,
  replacePolicy,
} from '../policy/store';
import { ApiError } from './api';
import { API_BASE_URL, POLICY_REFRESH_MINUTES } from './config';
import { createPolicySync } from './policy-sync';
import { Session } from './session';

const POLICY_ALARM = 'hares-policy-refresh';

export const session = new Session({
  api: { baseUrl: API_BASE_URL, fetch: (input, init) => fetch(input, init) },
  local: browser.storage.local,
  session: browser.storage.session,
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
  },
});

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
    await session.logout();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export function installBackend(): void {
  // Leaving the session (sign-out, expiry, deactivation) drops the policy of
  // that user: the next one must not run under it.
  session.onSignedOut(() => clearPolicy());

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
    return;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLICY_ALARM) void syncPolicy();
  });
  // Creating an alarm with an existing name replaces it, so this is safe on every start.
  void browser.alarms.create(POLICY_ALARM, { periodInMinutes: POLICY_REFRESH_MINUTES });

  browser.runtime.onStartup.addListener(() => void syncPolicy());
  browser.runtime.onInstalled.addListener(() => void syncPolicy());
}
