/**
 * Hares AI — which API this build talks to.
 *
 * Kept free of browser APIs so the build config can use it too. The production
 * API is the platform's Vercel address; the login protection there only covers
 * traffic that goes through it, so never point a build at the host behind it.
 */

export const DEFAULT_API_BASE_URL = 'https://hares-ai.vercel.app/api';

/** Plain HTTP is allowed only for a server on this machine, for development. */
function isAllowed(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/** The base URL to use for `override` (from the build environment), without a trailing slash. */
export function resolveApiBaseUrl(override: string | undefined): string {
  const candidate = override?.trim();
  if (candidate) {
    try {
      if (isAllowed(new URL(candidate))) return candidate.replace(/\/+$/, '');
    } catch {
      // Not a URL: fall through to the default.
    }
  }
  return DEFAULT_API_BASE_URL;
}
