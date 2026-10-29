/**
 * Hares AI — backend connection settings.
 *
 * The API base URL is fixed at build time, one build per environment:
 *   WXT_API_BASE_URL=https://api.example.com/api npm run build
 * It defaults to the local development API.
 */

export const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

function fromEnv(): string | undefined {
  const value = import.meta.env?.WXT_API_BASE_URL as string | undefined;
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Base URL without a trailing slash, e.g. `http://localhost:3000/api`. */
export const API_BASE_URL: string = (fromEnv() ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');

function minutesFromEnv(): number | undefined {
  const value = Number(import.meta.env?.WXT_POLICY_REFRESH_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * How often the policy bundle is checked in the background, in minutes.
 * Chrome does not run alarms more often than every 30 seconds, so the floor is 0.5.
 * Override at build time with `WXT_POLICY_REFRESH_MINUTES`.
 */
export const POLICY_REFRESH_MINUTES = Math.max(0.5, minutesFromEnv() ?? 1);

/**
 * A message about to be checked asks for a fresh policy first if the last check
 * is older than this. An unchanged policy costs a 304 with no body, so this
 * keeps the policy current at the moment it matters without constant polling.
 */
export const POLICY_MAX_AGE_ON_SEND_MS = 15_000;

/** How long a send waits for that check before going ahead with the stored policy. */
export const POLICY_FRESH_WAIT_MS = 1500;
