/** Test doubles for the backend layer: in-memory storage and a scripted fetch. */

import type { FetchLike } from '../../src/backend/api';
import type { KeyValueArea } from '../../src/backend/session';

export class MemoryArea implements KeyValueArea {
  readonly data = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (this.data.has(key)) out[key] = structuredClone(this.data.get(key));
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, structuredClone(value));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key);
  }
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ScriptedResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * A fetch that answers from `handler` and records every request. `handler`
 * may return a promise (to hold an answer) or throw (a network failure).
 */
export function scriptedFetch(
  handler: (request: RecordedRequest) => ScriptedResponse | Promise<ScriptedResponse>,
): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const request: RecordedRequest = {
      url: input,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const answer = await handler(request);
    const status = answer.status ?? 200;
    return new Response(status === 204 || status === 304 ? null : JSON.stringify(answer.body ?? {}), {
      status,
      headers: answer.headers,
    });
  };
  return { fetch: fetchFn, requests };
}

export const TOKENS = (n: number) => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  expires_in: 3600,
});

export function apiError(status: number, code: string, extra: Partial<ScriptedResponse> = {}): ScriptedResponse {
  return { status, body: { status, code, message: code.toLowerCase(), request_id: 'req-1' }, ...extra };
}
