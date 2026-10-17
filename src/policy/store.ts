/**
 * Hares AI — where the active policy and the user's exceptions live.
 *
 * Both are kept in `chrome.storage.local` and validated on every read, so a
 * corrupted or tampered value falls back to the last good / default policy.
 * Content scripts load them once and then follow `storage.onChanged`, so a new
 * policy from the platform applies to the next message without a reload.
 *
 * Platform integration (later) only needs to call `savePolicy(raw)` with the
 * department policy from the backend; nothing else in the extension changes.
 */

import { browser } from 'wxt/browser';
import { DEFAULT_POLICY } from './defaults';
import type { Policy, UserExceptions } from './types';
import { validatePolicy } from './validate';
import { CATEGORIES, type CategoryId } from '../detectors/categories';

export const POLICY_KEY = 'hares.policy';
export const EXCEPTIONS_KEY = 'hares.userExceptions';

function parseExceptions(raw: unknown): UserExceptions | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { categories, labels, until } = raw as Record<string, unknown>;
  const valid = Array.isArray(categories)
    ? categories.filter((c): c is CategoryId => typeof c === 'string' && c in CATEGORIES)
    : [];
  const validLabels = Array.isArray(labels)
    ? labels.filter((l): l is string => typeof l === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(l))
    : [];
  return {
    categories: valid,
    labels: validLabels,
    ...(typeof until === 'string' && !Number.isNaN(Date.parse(until)) ? { until } : {}),
  };
}

/** Keep a newer policy only; an older or equal version never replaces the current one. */
export async function savePolicy(raw: unknown): Promise<{ saved: boolean; warnings: string[] }> {
  const { policy, warnings } = validatePolicy(raw);
  if (!policy) return { saved: false, warnings };
  const current = await loadPolicy();
  if (policy.version <= current.version && current !== DEFAULT_POLICY) {
    return { saved: false, warnings: [...warnings, `version ${policy.version} is not newer than ${current.version}`] };
  }
  await browser.storage.local.set({ [POLICY_KEY]: policy });
  return { saved: true, warnings };
}

export async function loadPolicy(): Promise<Policy> {
  try {
    const stored = await browser.storage.local.get(POLICY_KEY);
    return validatePolicy(stored[POLICY_KEY]).policy ?? DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function loadExceptions(): Promise<UserExceptions | null> {
  try {
    const stored = await browser.storage.local.get(EXCEPTIONS_KEY);
    return parseExceptions(stored[EXCEPTIONS_KEY]);
  } catch {
    return null;
  }
}

export async function saveExceptions(exceptions: UserExceptions): Promise<void> {
  await browser.storage.local.set({ [EXCEPTIONS_KEY]: exceptions });
}

/** Live view of policy + exceptions for a content script. */
export class PolicyState {
  policy: Policy = DEFAULT_POLICY;
  exceptions: UserExceptions | null = null;

  async start(): Promise<void> {
    [this.policy, this.exceptions] = await Promise.all([loadPolicy(), loadExceptions()]);
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (POLICY_KEY in changes) {
          this.policy = validatePolicy(changes[POLICY_KEY]?.newValue).policy ?? DEFAULT_POLICY;
        }
        if (EXCEPTIONS_KEY in changes) {
          this.exceptions = parseExceptions(changes[EXCEPTIONS_KEY]?.newValue);
        }
      });
    } catch (error) {
      console.warn('[hares] could not watch policy changes:', error);
    }
  }
}
