import { describe, expect, it } from 'vitest';
import { ApiError, apiRequest, type FetchLike } from '../../src/backend/api';
import { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from '../../src/backend/api-url';
import { loginErrorMessage } from '../../src/backend/messages';

describe('API base URL', () => {
  it('defaults to the production platform on HTTPS', () => {
    expect(DEFAULT_API_BASE_URL).toBe('https://hares-ai.vercel.app/api');
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('  ')).toBe(DEFAULT_API_BASE_URL);
  });

  it('accepts another HTTPS server, and plain HTTP only on this machine', () => {
    expect(resolveApiBaseUrl('https://api.example.com/api/')).toBe('https://api.example.com/api');
    expect(resolveApiBaseUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api');
    expect(resolveApiBaseUrl('http://127.0.0.1:3000/api')).toBe('http://127.0.0.1:3000/api');
  });

  it('refuses plain HTTP to a remote host and anything that is not a URL', () => {
    expect(resolveApiBaseUrl('http://api.example.com/api')).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('http://localhost.evil.com/api')).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('not a url')).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl('ftp://example.com/api')).toBe(DEFAULT_API_BASE_URL);
  });
});

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('waiting for a sleeping server', () => {
  const sleeps: number[] = [];
  const base = { baseUrl: 'https://x.test/api', sleep: async (ms: number) => void sleeps.push(ms) };

  it('retries a request that is safe to repeat while the server is not ready, then succeeds', async () => {
    sleeps.length = 0;
    const answers = [503, 502, 200];
    const fetch: FetchLike = async () => json(answers.shift()!, { ok: true });
    const response = await apiRequest({ ...base, fetch }, '/extension/login', { method: 'POST', json: {}, retries: 2 });
    expect(response.status).toBe(200);
    expect(sleeps).toEqual([3000, 3000]);
  });

  it('stops after the allowed retries', async () => {
    const fetch: FetchLike = async () => json(503, { code: 'UNAVAILABLE', message: 'down' });
    await expect(apiRequest({ ...base, fetch }, '/x', { retries: 1 })).rejects.toMatchObject({ status: 503 });
  });

  it('does not retry by default, nor refusals such as a wrong password', async () => {
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return json(401, { code: 'INVALID_CREDENTIALS' });
    };
    await expect(apiRequest({ ...base, fetch }, '/x', { retries: 2 })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calls).toBe(1);
    calls = 0;
    const down: FetchLike = async () => {
      calls += 1;
      return json(503);
    };
    await expect(apiRequest({ ...base, fetch: down }, '/x')).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it('gives up on one answer after the timeout, with its own error code', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const error = await apiRequest({ ...base, fetch, timeoutMs: 20 }, '/x').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: 'TIMEOUT' });
    expect(loginErrorMessage('TIMEOUT')).toMatch(/waking up/);
  });
});
