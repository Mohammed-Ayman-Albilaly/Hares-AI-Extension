/**
 * Hares AI — the signed-in session with the backend.
 *
 * - The password is sent once to `/extension/login` and never stored.
 * - The access token (short-lived) lives in `storage.session`, which is memory
 *   only and not readable by content scripts. The refresh token lives in
 *   `storage.local`, so the user stays signed in across browser restarts.
 * - The refresh token is rotating: an old one sent again revokes the whole
 *   session. Refreshes are therefore single-flight (one at a time, callers
 *   share the result) and the new refresh token is saved before anything else.
 * - A 401 on refresh, or ACCOUNT_INACTIVE, ends the session: tokens are cleared
 *   and the popup shows the sign-in screen again.
 */

import { ApiError, apiRequest, type ApiDeps, type ApiResponse } from './api';

/** Where tokens and the auth state are stored (the shape of `browser.storage.*`). */
export interface KeyValueArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const ACCESS_TOKEN_KEY = 'hares.accessToken';
export const REFRESH_TOKEN_KEY = 'hares.refreshToken';
export const AUTH_STATE_KEY = 'hares.auth';

export type SignOutReason = 'USER' | 'SESSION_EXPIRED' | 'ACCOUNT_INACTIVE';

export type AuthState =
  | { status: 'SIGNED_OUT'; reason?: SignOutReason }
  | { status: 'SIGNED_IN'; email: string };

interface StoredAccessToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Refresh this long before the access token expires. */
const EXPIRY_SKEW_MS = 60_000;

function isTokenPair(value: unknown): value is TokenPair {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === 'string' &&
    typeof v.refresh_token === 'string' &&
    typeof v.expires_in === 'number' &&
    v.expires_in > 0
  );
}

export interface SessionDeps {
  api: ApiDeps;
  local: KeyValueArea;
  session: KeyValueArea;
  now?: () => number;
}

export class Session {
  private refreshing: Promise<void> | null = null;
  private signedOutListeners: Array<(reason: SignOutReason) => void | Promise<void>> = [];
  private readonly now: () => number;

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Run `listener` whenever the session ends (sign-out, expiry, deactivation). */
  onSignedOut(listener: (reason: SignOutReason) => void | Promise<void>): void {
    this.signedOutListeners.push(listener);
  }

  async state(): Promise<AuthState> {
    const stored = (await this.deps.local.get(AUTH_STATE_KEY))[AUTH_STATE_KEY] as AuthState | undefined;
    if (stored?.status === 'SIGNED_IN' && typeof stored.email === 'string') return stored;
    return { status: 'SIGNED_OUT', ...(stored?.status === 'SIGNED_OUT' && stored.reason ? { reason: stored.reason } : {}) };
  }

  async isSignedIn(): Promise<boolean> {
    return (await this.state()).status === 'SIGNED_IN';
  }

  /** Sign in. Throws `ApiError` (INVALID_CREDENTIALS, ACCOUNT_NO_ACCESS, ACCOUNT_INACTIVE, RATE_LIMITED…). */
  async login(email: string, password: string): Promise<void> {
    const response = await apiRequest<unknown>(this.deps.api, '/extension/login', {
      method: 'POST',
      json: { email, password },
      // Signing in twice is harmless, and the first request can hit a sleeping server.
      retries: 2,
    });
    if (!isTokenPair(response.body)) throw new ApiError(response.status, 'BAD_RESPONSE', 'Unexpected answer from the server');
    await this.saveTokens(response.body);
    await this.deps.local.set({ [AUTH_STATE_KEY]: { status: 'SIGNED_IN', email: email.trim().toLowerCase() } satisfies AuthState });
  }

  /** Sign out: tell the server (best effort), then forget everything. */
  async logout(): Promise<void> {
    const refreshToken = await this.refreshToken();
    if (refreshToken) {
      try {
        await apiRequest(this.deps.api, '/extension/logout', { method: 'POST', json: { refresh_token: refreshToken } });
      } catch {
        // The session is ended locally either way.
      }
    }
    await this.endSession('USER');
  }

  /** A valid access token, refreshing first when it is missing or about to expire. */
  async accessToken(): Promise<string> {
    const stored = await this.storedAccessToken();
    if (stored && stored.expiresAt - EXPIRY_SKEW_MS > this.now()) return stored.token;
    await this.refresh(stored?.token);
    const fresh = await this.storedAccessToken();
    if (!fresh) throw new ApiError(401, 'NOT_SIGNED_IN', 'Not signed in');
    return fresh.token;
  }

  /**
   * An authorised request. A 401 refreshes the tokens once and retries; if that
   * fails too, or the account is deactivated, the session ends.
   */
  async request<T = unknown>(
    path: string,
    init: { method?: string; headers?: Record<string, string>; json?: unknown } = {},
  ): Promise<ApiResponse<T>> {
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.accessToken();
      try {
        return await apiRequest<T>(this.deps.api, path, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if (error.code === 'ACCOUNT_INACTIVE') {
          await this.endSession('ACCOUNT_INACTIVE');
          throw error;
        }
        if (attempt > 0) {
          await this.endSession('SESSION_EXPIRED');
          throw error;
        }
        await this.refresh(token);
      }
    }
  }

  /**
   * Refresh the tokens, one request at a time. `staleToken` is the access token
   * the caller just saw rejected: if another caller already replaced it, there
   * is nothing to do (a second refresh would only rotate the token again).
   */
  refresh(staleToken?: string): Promise<void> {
    this.refreshing ??= this.doRefresh(staleToken).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(staleToken: string | undefined): Promise<void> {
    if (staleToken !== undefined) {
      const current = await this.storedAccessToken();
      if (current && current.token !== staleToken && current.expiresAt - EXPIRY_SKEW_MS > this.now()) return;
    }
    const refreshToken = await this.refreshToken();
    if (!refreshToken) {
      await this.endSession('SESSION_EXPIRED');
      throw new ApiError(401, 'NOT_SIGNED_IN', 'Not signed in');
    }
    try {
      const response = await apiRequest<unknown>(this.deps.api, '/extension/refresh', {
        method: 'POST',
        json: { refresh_token: refreshToken },
      });
      if (!isTokenPair(response.body)) throw new ApiError(response.status, 'BAD_RESPONSE', 'Unexpected answer from the server');
      await this.saveTokens(response.body);
    } catch (error) {
      // 401: the refresh token is no longer valid (expired, revoked, or reused).
      if (error instanceof ApiError && error.status === 401) {
        await this.endSession(error.code === 'ACCOUNT_INACTIVE' ? 'ACCOUNT_INACTIVE' : 'SESSION_EXPIRED');
      }
      // Network errors and 5xx keep the tokens: the next attempt may succeed.
      throw error;
    }
  }

  private async saveTokens(pair: TokenPair): Promise<void> {
    // The rotated refresh token goes first: losing it would sign the user out.
    await this.deps.local.set({ [REFRESH_TOKEN_KEY]: pair.refresh_token });
    const access: StoredAccessToken = { token: pair.access_token, expiresAt: this.now() + pair.expires_in * 1000 };
    await this.deps.session.set({ [ACCESS_TOKEN_KEY]: access });
  }

  private async storedAccessToken(): Promise<StoredAccessToken | null> {
    const value = (await this.deps.session.get(ACCESS_TOKEN_KEY))[ACCESS_TOKEN_KEY] as StoredAccessToken | undefined;
    return value && typeof value.token === 'string' && typeof value.expiresAt === 'number' ? value : null;
  }

  private async refreshToken(): Promise<string | null> {
    const value = (await this.deps.local.get(REFRESH_TOKEN_KEY))[REFRESH_TOKEN_KEY];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private async endSession(reason: SignOutReason): Promise<void> {
    await this.deps.local.remove(REFRESH_TOKEN_KEY);
    await this.deps.session.remove(ACCESS_TOKEN_KEY);
    await this.deps.local.set({ [AUTH_STATE_KEY]: { status: 'SIGNED_OUT', reason } satisfies AuthState });
    for (const listener of this.signedOutListeners) {
      try {
        await listener(reason);
      } catch (error) {
        console.warn('[hares] sign-out cleanup failed:', error);
      }
    }
  }
}
