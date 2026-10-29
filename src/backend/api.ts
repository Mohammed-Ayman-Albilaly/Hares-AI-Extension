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

/**
 * Send one request. Resolves with every answer below 400, plus 304 (not
 * modified); throws `ApiError` for the rest.
 */
export async function apiRequest<T = unknown>(
  deps: ApiDeps,
  path: string,
  init: { method?: string; headers?: Record<string, string>; json?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  let response: Response;
  try {
    response = await deps.fetch(`${deps.baseUrl}${path}`, { method: init.method ?? 'GET', headers, body, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
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
