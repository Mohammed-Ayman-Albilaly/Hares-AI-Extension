/**
 * Hares AI — toolbar popup: sign in, see the connection status, sign out.
 *
 * It only reads state from storage and sends sign-in / sign-out requests to
 * the background service worker, which makes every call to the API. The
 * password is read from the form, sent once, and the field is cleared.
 */

import { browser } from 'wxt/browser';
import { loginErrorMessage, signedOutMessage } from '../../src/backend/messages';
import { OUTBOX_KEY } from '../../src/backend/outbox';
import { AUTH_STATE_KEY, type AuthState, type SignOutReason } from '../../src/backend/session';
import { UPLOAD_STATE_KEY, type UploadState } from '../../src/backend/uploader';
import {
  MSG,
  TARGET,
  type AuthLoginRequest,
  type AuthLogoutRequest,
  type AuthResponse,
} from '../../src/messaging/protocol';
import { POLICY_FETCHED_AT_KEY, POLICY_KEY } from '../../src/policy/store';

const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function field(label: string, input: HTMLInputElement): HTMLLabelElement {
  const wrapper = el('label', label);
  wrapper.append(input);
  return wrapper;
}

async function send(request: AuthLoginRequest | AuthLogoutRequest): Promise<AuthResponse> {
  try {
    return ((await browser.runtime.sendMessage(request)) as AuthResponse | undefined) ?? { ok: false, code: 'UNKNOWN' };
  } catch {
    return { ok: false, code: 'UNKNOWN' };
  }
}

function renderSignedOut(reason: SignOutReason | undefined): void {
  const form = el('form');
  form.noValidate = false;
  const email = el('input');
  email.type = 'email';
  email.required = true;
  email.autocomplete = 'username';
  const password = el('input');
  password.type = 'password';
  password.required = true;
  password.autocomplete = 'current-password';
  const submit = el('button', 'Sign in');
  submit.type = 'submit';
  const error = el('p', undefined, 'error');
  error.role = 'alert';

  form.append(field('Email', email), field('Password', password), submit, error);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    error.textContent = '';
    const slow = setTimeout(() => {
      error.textContent = 'Connecting… the first sign-in can take up to a minute.';
    }, 5000);
    const request: AuthLoginRequest = {
      target: TARGET.BACKGROUND,
      type: MSG.AUTH_LOGIN,
      email: email.value.trim(),
      password: password.value,
    };
    password.value = '';
    void send(request).then((response) => {
      clearTimeout(slow);
      submit.disabled = false;
      submit.textContent = 'Sign in';
      error.textContent = '';
      // On success the state change in storage re-renders the popup.
      if (!response.ok) error.textContent = loginErrorMessage(response.code, response.retryAfterSeconds);
    });
  });

  const message = signedOutMessage(reason);
  app.replaceChildren(
    el('h1', 'Hares AI'),
    ...(message ? [el('p', message, 'notice')] : []),
    el('p', 'Sign in with your Hares AI account to apply your organisation’s policy.', 'muted'),
    form,
  );
}

async function renderSignedIn(email: string): Promise<void> {
  const stored = await browser.storage.local.get([POLICY_KEY, POLICY_FETCHED_AT_KEY, OUTBOX_KEY, UPLOAD_STATE_KEY]);
  const policy = stored[POLICY_KEY] as { version?: number } | undefined;
  const checkedAt = stored[POLICY_FETCHED_AT_KEY];

  const details = el('dl');
  details.append(el('dt', 'Account'), el('dd', email));
  details.append(
    el('dt', 'Policy'),
    el('dd', policy?.version !== undefined ? `Version ${policy.version}` : 'Built-in default'),
  );
  if (typeof checkedAt === 'string') {
    details.append(el('dt', 'Checked'), el('dd', new Date(checkedAt).toLocaleTimeString()));
  }

  const waiting = Array.isArray(stored[OUTBOX_KEY]) ? (stored[OUTBOX_KEY] as unknown[]).length : 0;
  details.append(el('dt', 'Waiting'), el('dd', waiting === 0 ? 'Nothing to upload' : `${waiting} event${waiting === 1 ? '' : 's'} to upload`));
  const paused = (stored[UPLOAD_STATE_KEY] as UploadState | undefined)?.paused === true;

  const signOut = el('button', 'Sign out', 'secondary');
  signOut.type = 'button';
  signOut.addEventListener('click', () => {
    signOut.disabled = true;
    void send({ target: TARGET.BACKGROUND, type: MSG.AUTH_LOGOUT });
  });

  app.replaceChildren(
    el('h1', 'Hares AI'),
    el('p', 'Protection is on.'),
    ...(paused ? [el('p', 'Uploads are paused: your department is inactive. Protection continues.', 'notice')] : []),
    details,
    signOut,
  );
}

async function render(): Promise<void> {
  const stored = await browser.storage.local.get(AUTH_STATE_KEY);
  const state = stored[AUTH_STATE_KEY] as AuthState | undefined;
  if (state?.status === 'SIGNED_IN') await renderSignedIn(state.email);
  else renderSignedOut(state?.status === 'SIGNED_OUT' ? state.reason : undefined);
}

browser.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void render();
});
void render();
