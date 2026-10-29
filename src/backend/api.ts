/**
 * Hares AI — thin HTTP layer for the backend API.
 *
 * Every error answer has the shape `{ status, code, message, details?, request_id }`
 * and becomes an `ApiError`. A network failure becomes an `ApiError` with
 * status 0, so callers handle one kind of error. Request and response bodies
 * never contain prompt text.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
    /** Seconds to wait, from the `Retry-After` header (429). */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T | undefined;
  headers: Headers;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiDeps {
  baseUrl: string;
  fetch: FetchLike;
  /** Give up on one answer after this long (status 0, code TIMEOUT). No limit when omitted. */
  timeoutMs?: number;
  /** Wait between attempts; replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called with the `Date` header of every answer (clock correction). */
  onServerDate?: (date: string) => void;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toApiError(response: Response, body: unknown): ApiError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return new ApiError(
    response.status,
    typeof record.code === 'string' ? record.code : `HTTP_${response.status}`,
    typeof record.message === 'string' ? record.message : response.statusText || 'Request failed',
    typeof record.request_id === 'string' ? record.request_id : undefined,
    record.details,
    parseRetryAfter(response.headers.get('Retry-After')),
  );
}

/** Answers that mean the server is not ready (asleep, restarting), as opposed to refusing the request. */
const TRY_AGAIN_STATUSES = new Set([0, 502, 503, 504]);
const RETRY_DELAY_MS = 3000;

/**
 * Send one request. Resolves with every answer below 400, plus 304 (not
 * modified); throws `ApiError` for the rest.
 *
 * `retries` repeats the request when the server did not answer or is not ready
 * (network error, timeout, 502/503/504). Use it only for requests that are safe
 * to send twice: never for the refresh token, which rotates.
 */
export async function apiRequest<T = unknown>(
  deps: ApiDeps,
  path: string,
  init: { method?: string; headers?: Record<string, string>; json?: unknown; retries?: number } = {},
): Promise<ApiResponse<T>> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendOnce<T>(deps, path, init);
    } catch (error) {
      const again = error instanceof ApiError && TRY_AGAIN_STATUSES.has(error.status) && attempt < (init.retries ?? 0);
      if (!again) throw error;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function sendOnce<T>(
  deps: ApiDeps,
  path: string,
  init: { method?: string; headers?: Record<string, string>; json?: unknown },
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  const controller = deps.timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), deps.timeoutMs) : undefined;
  let response: Response;
  try {
    response = await deps.fetch(`${deps.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body,
      cache: 'no-store',
      signal: controller?.signal,
    });
  } catch {
    if (controller?.signal.aborted) throw new ApiError(0, 'TIMEOUT', 'The server did not answer in time');
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  } finally {
    clearTimeout(timer);
  }

  const date = response.headers.get('Date');
  if (date) deps.onServerDate?.(date);

  if (response.status >= 400) throw toApiError(response, await readJson(response));
  return {
    status: response.status,
    body: response.status === 204 || response.status === 304 ? undefined : ((await readJson(response)) as T | undefined),
    headers: response.headers,
  };
}
