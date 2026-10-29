import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/backend/api';
import {
  ACCESS_TOKEN_KEY,
  AUTH_STATE_KEY,
  REFRESH_TOKEN_KEY,
  Session,
  type SignOutReason,
} from '../../src/backend/session';
import { MemoryArea, TOKENS, apiError, scriptedFetch, type RecordedRequest, type ScriptedResponse } from '../helpers/backend';

const BASE = 'http://api.test/api';

function setup(handler: (r: RecordedRequest) => ScriptedResponse | Promise<ScriptedResponse>, start = 1_000_000) {
  const local = new MemoryArea();
  const sessionArea = new MemoryArea();
  const { fetch, requests } = scriptedFetch(handler);
  const clock = { now: start };
  const session = new Session({ api: { baseUrl: BASE, fetch }, local, session: sessionArea, now: () => clock.now });
  const signedOut: SignOutReason[] = [];
  session.onSignedOut((reason) => {
    signedOut.push(reason);
  });
  return { session, local, sessionArea, requests, clock, signedOut };
}

const login = (r: RecordedRequest) => r.url.endsWith('/extension/login');
const refresh = (r: RecordedRequest) => r.url.endsWith('/extension/refresh');

describe('login', () => {
  it('stores the refresh token in local storage and the access token in session storage', async () => {
    const t = setup(() => ({ status: 200, body: TOKENS(1) }));
    await t.session.login('Eng.User1@Example.test', 'secret');
    expect(t.requests[0]).toMatchObject({ url: `${BASE}/extension/login`, method: 'POST', body: { email: 'Eng.User1@Example.test', password: 'secret' } });
    expect(t.local.data.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
    expect(t.sessionArea.data.get(ACCESS_TOKEN_KEY)).toMatchObject({ token: 'access-1', expiresAt: 1_000_000 + 3600_000 });
    expect(await t.session.state()).toEqual({ status: 'SIGNED_IN', email: 'eng.user1@example.test' });
  });

  it('never stores the password anywhere', async () => {
    const t = setup(() => ({ status: 200, body: TOKENS(1) }));
    await t.session.login('a@example.test', 'Sup3r-secret-pw');
    const everything = JSON.stringify([...t.local.data, ...t.sessionArea.data]);
    expect(everything).not.toContain('Sup3r-secret-pw');
  });

  it.each(['INVALID_CREDENTIALS', 'ACCOUNT_NO_ACCESS', 'ACCOUNT_INACTIVE'])('%s is thrown as an ApiError and nothing is stored', async (code) => {
    const t = setup(() => apiError(401, code));
    await expect(t.session.login('a@example.test', 'x')).rejects.toMatchObject({ code, status: 401 });
    expect(t.local.data.size).toBe(0);
    expect(await t.session.isSignedIn()).toBe(false);
  });

  it('RATE_LIMITED carries the Retry-After delay', async () => {
    const t = setup(() => apiError(429, 'RATE_LIMITED', { headers: { 'Retry-After': '17' } }));
    await expect(t.session.login('a@example.test', 'x')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 17 });
  });

  it('a network failure is an ApiError with status 0', async () => {
    const t = setup(() => {
      throw new Error('offline');
    });
    const error = await t.session.login('a@example.test', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNetworkError).toBe(true);
  });

  it('rejects an answer without a token pair', async () => {
    const t = setup(() => ({ status: 200, body: { access_token: 'x' } }));
    await expect(t.session.login('a@example.test', 'x')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('refresh', () => {
  async function signedIn(extra: (r: RecordedRequest) => ScriptedResponse | Promise<ScriptedResponse>) {
    let n = 0;
    const t = setup((r) => {
      if (login(r)) return { body: TOKENS(++n) };
      return extra(r);
    });
    await t.session.login('a@example.test', 'x');
    return { ...t, nextN: () => ++n };
  }

  it('rotates the refresh token and uses the new access token', async () => {
    let n = 1;
    const t = await signedIn((r) => (refresh(r) ? { body: TOKENS(++n) } : { body: { ok: true } }));
    t.clock.now += 3600_000; // the access token has expired
    await t.session.request('/policy/bundle');
    const refreshCall = t.requests.find(refresh)!;
    expect(refreshCall.body).toEqual({ refresh_token: 'refresh-1' });
    expect(t.local.data.get(REFRESH_TOKEN_KEY)).toBe('refresh-2');
    expect(t.requests.at(-1)!.headers.Authorization).toBe('Bearer access-2');
  });

  it('is single-flight: parallel callers share one refresh request', async () => {
    let n = 1;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = await signedIn(async (r) => {
      if (refresh(r)) {
        await gate;
        return { body: TOKENS(++n) };
      }
      return { body: { ok: true } };
    });
    t.clock.now += 3600_000;
    const calls = [t.session.request('/a'), t.session.request('/b'), t.session.request('/c')];
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all(calls);
    expect(t.requests.filter(refresh)).toHaveLength(1);
    expect(t.requests.filter((r) => !login(r) && !refresh(r)).every((r) => r.headers.Authorization === 'Bearer access-2')).toBe(true);
  });

  it('a 401 on refresh ends the session', async () => {
    const t = await signedIn((r) => (refresh(r) ? apiError(401, 'INVALID_REFRESH_TOKEN') : { body: {} }));
    t.clock.now += 3600_000;
    await expect(t.session.request('/policy/bundle')).rejects.toMatchObject({ status: 401 });
    expect(await t.session.state()).toEqual({ status: 'SIGNED_OUT', reason: 'SESSION_EXPIRED' });
    expect(t.local.data.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(t.sessionArea.data.has(ACCESS_TOKEN_KEY)).toBe(false);
    expect(t.signedOut).toEqual(['SESSION_EXPIRED']);
  });

  it('a network failure or server error keeps the tokens for the next attempt', async () => {
    const t = await signedIn((r) => (refresh(r) ? apiError(503, 'UNAVAILABLE') : { body: {} }));
    t.clock.now += 3600_000;
    await expect(t.session.request('/policy/bundle')).rejects.toMatchObject({ status: 503 });
    expect(await t.session.isSignedIn()).toBe(true);
    expect(t.local.data.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
    expect(t.signedOut).toEqual([]);
  });
});

describe('authorised requests', () => {
  async function signedIn(extra: (r: RecordedRequest) => ScriptedResponse) {
    let n = 1;
    const t = setup((r) => {
      if (login(r)) return { body: TOKENS(1) };
      if (refresh(r)) return { body: TOKENS(++n) };
      return extra(r);
    });
    await t.session.login('a@example.test', 'x');
    return t;
  }

  it('send the access token as a Bearer header', async () => {
    const t = await signedIn(() => ({ body: { ok: true } }));
    await t.session.request('/policy/bundle', { headers: { 'If-None-Match': '"v1"' } });
    expect(t.requests.at(-1)!.headers).toMatchObject({ Authorization: 'Bearer access-1', 'If-None-Match': '"v1"' });
  });

  it('TOKEN_EXPIRED refreshes once and retries with the new token', async () => {
    let calls = 0;
    const t = await signedIn((r) => (r.headers.Authorization === 'Bearer access-1' && ++calls ? apiError(401, 'TOKEN_EXPIRED') : { body: { ok: true } }));
    const response = await t.session.request('/logs', { method: 'POST', json: {} });
    expect(response.status).toBe(200);
    expect(t.requests.filter(refresh)).toHaveLength(1);
    expect(t.requests.at(-1)!.headers.Authorization).toBe('Bearer access-2');
  });

  it('a second 401 after refreshing ends the session', async () => {
    const t = await signedIn(() => apiError(401, 'TOKEN_EXPIRED'));
    await expect(t.session.request('/logs')).rejects.toMatchObject({ status: 401 });
    expect(await t.session.state()).toEqual({ status: 'SIGNED_OUT', reason: 'SESSION_EXPIRED' });
  });

  it('ACCOUNT_INACTIVE ends the session at once, without refreshing', async () => {
    const t = await signedIn(() => apiError(401, 'ACCOUNT_INACTIVE'));
    await expect(t.session.request('/logs')).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    expect(t.requests.filter(refresh)).toHaveLength(0);
    expect(await t.session.state()).toEqual({ status: 'SIGNED_OUT', reason: 'ACCOUNT_INACTIVE' });
    expect(t.signedOut).toEqual(['ACCOUNT_INACTIVE']);
  });

  it('other errors pass through and keep the session', async () => {
    const t = await signedIn(() => apiError(403, 'DEPARTMENT_INACTIVE'));
    await expect(t.session.request('/logs')).rejects.toMatchObject({ status: 403, code: 'DEPARTMENT_INACTIVE' });
    expect(await t.session.isSignedIn()).toBe(true);
  });

  it('without tokens there is nothing to send', async () => {
    const t = setup(() => ({ body: {} }));
    await expect(t.session.request('/policy/bundle')).rejects.toMatchObject({ status: 401 });
    expect(t.requests).toHaveLength(0);
  });
});

describe('logout', () => {
  it('tells the server, forgets the tokens and notifies listeners', async () => {
    const t = setup((r) => (login(r) ? { body: TOKENS(1) } : { status: 204 }));
    await t.session.login('a@example.test', 'x');
    await t.session.logout();
    expect(t.requests.at(-1)).toMatchObject({ url: `${BASE}/extension/logout`, body: { refresh_token: 'refresh-1' } });
    expect(t.local.data.has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(await t.session.state()).toEqual({ status: 'SIGNED_OUT', reason: 'USER' });
    expect(t.signedOut).toEqual(['USER']);
  });

  it('signs out locally even when the server cannot be reached', async () => {
    const t = setup((r) => {
      if (login(r)) return { body: TOKENS(1) };
      throw new Error('offline');
    });
    await t.session.login('a@example.test', 'x');
    await t.session.logout();
    expect(await t.session.isSignedIn()).toBe(false);
    expect(t.local.data.get(AUTH_STATE_KEY)).toEqual({ status: 'SIGNED_OUT', reason: 'USER' });
  });
});
