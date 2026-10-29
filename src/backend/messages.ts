/** Hares AI — user-facing wording for sign-in problems. */

import type { SignOutReason } from './session';

export function loginErrorMessage(code: string | undefined, retryAfterSeconds?: number): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'Wrong email or password.';
    case 'ACCOUNT_NO_ACCESS':
      return 'Your account is waiting for approval, or was rejected. Contact your administrator.';
    case 'ACCOUNT_INACTIVE':
      return 'Your account is deactivated. Contact your administrator.';
    case 'RATE_LIMITED':
      return retryAfterSeconds
        ? `Too many attempts. Try again in ${retryAfterSeconds} seconds.`
        : 'Too many attempts. Try again in a moment.';
    case 'NETWORK_ERROR':
      return 'Cannot reach the Hares AI server. Check your connection and try again.';
    default:
      return 'Could not sign in. Try again.';
  }
}

/** Why the user was signed out; null when they chose to (nothing to explain). */
export function signedOutMessage(reason: SignOutReason | undefined): string | null {
  switch (reason) {
    case 'SESSION_EXPIRED':
      return 'Your session ended. Please sign in again.';
    case 'ACCOUNT_INACTIVE':
      return 'Your account is deactivated. Contact your administrator.';
    default:
      return null;
  }
}
