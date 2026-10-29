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

/** How often the policy bundle is checked, in minutes. */
export const POLICY_REFRESH_MINUTES = 5;
