/**
 * Hares AI — built-in default policy and policy lookups.
 *
 * The default policy is the PDF tier table (src/detectors/categories.ts) with
 * no user exceptions allowed. Lookups take a policy and fall back to the
 * built-in values for anything it leaves out.
 */

import { CATEGORIES, type CategoryId, type Tier } from '../detectors/categories';
import type { Policy, UserExceptions } from './types';

export const DEFAULT_POLICY: Policy = {
  version: 0,
  departmentId: 'default',
};

/** Tier of a category under a policy. */
export function policyTier(category: CategoryId, policy: Policy = DEFAULT_POLICY): Tier {
  return policy.categories?.[category]?.tier ?? CATEGORIES[category].tier;
}

/** Tier of one detected type: label override → category override → built-in table. */
export function detectionTier(
  d: { category: CategoryId; label: string },
  policy: Policy = DEFAULT_POLICY,
): Tier {
  return policy.labels?.[d.label]?.tier ?? policyTier(d.category, policy);
}

/** May the user exempt this detected type under this policy? */
export function isUserOverridable(
  d: { category: CategoryId; label: string },
  policy: Policy,
): boolean {
  return (
    policy.labels?.[d.label]?.userOverridable ??
    policy.categories?.[d.category]?.userOverridable ??
    false
  );
}

/** The user's exceptions that are still in effect (not expired). */
export interface ActiveExceptions {
  categories: ReadonlySet<CategoryId>;
  labels: ReadonlySet<string>;
}

export const NO_EXCEPTIONS: ActiveExceptions = { categories: new Set(), labels: new Set() };

export function activeExceptions(
  exceptions: UserExceptions | null | undefined,
  now: Date = new Date(),
): ActiveExceptions {
  if (!exceptions) return NO_EXCEPTIONS;
  if (exceptions.until && new Date(exceptions.until) < now) return NO_EXCEPTIONS;
  return { categories: new Set(exceptions.categories), labels: new Set(exceptions.labels ?? []) };
}

/** Is this detection exempted by the user AND allowed by the policy? */
export function isExempted(
  d: { category: CategoryId; label: string },
  policy: Policy,
  exceptions: ActiveExceptions,
): boolean {
  const requested = exceptions.labels.has(d.label) || exceptions.categories.has(d.category);
  return requested && isUserOverridable(d, policy);
}
