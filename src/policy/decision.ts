/**
 * Hares AI — deterministic decision: detections + context model → tier → actions
 * (docs/Hares AI.pdf Algorithm 15.3 and §6.1.4).
 *
 * tier = max(highest category tier among detections, context-model tier)
 *
 * The context model (zero-shot classifier run on the *masked* prompt) can raise
 * the tier to at most MEDIUM: it cannot point at a span, so a HIGH block driven
 * only by it would leave the user nothing to mask or remove. HIGH always
 * requires a concrete detection.
 *
 * Sending the original is never allowed on HIGH; sending the masked prompt is
 * allowed on every tier that has something masked.
 *
 * Two tiers come out of a decision:
 *  - `policyTier`: what the organisation's policy says. This is what the logs
 *    record and the platform dashboards show — a user exception never lowers it.
 *  - `tier`: what the extension enforces on this device. A category the user
 *    exempted (and the policy allows them to exempt) counts as LOW here: it is
 *    sent without a dialog, with the quiet toast as a reminder.
 */

import {
  TIER_RANK,
  UNMASKED_CATEGORIES,
  maxTier,
  type CategoryId,
  type Tier,
} from '../detectors/categories';
import type { Detection } from '../detectors/types';
import type { ClassifyResult } from '../model/contract';
import {
  DEFAULT_POLICY,
  NO_EXCEPTIONS,
  detectionTier as tierOfDetection,
  isExempted,
  policyTier as tierUnderPolicy,
  type ActiveExceptions,
} from './defaults';
import type { Policy } from './types';

export type Action = 'send' | 'confirm_send' | 'send_masked' | 'edit' | 'cancel';

/** How the extension presents the decision (PDF 6.1.4.1–6.1.4.6). */
export type Presentation = 'none' | 'notice' | 'confirm' | 'block';

export interface Decision {
  /** Tier enforced on this device (after the user's allowed exceptions). */
  tier: Tier;
  /** Tier under the organisation's policy — what the logs record. */
  policyTier: Tier;
  /** Detected categories the user exempted, so they were not enforced at their policy tier. */
  exceptedCategories: CategoryId[];
  /** Detected types (labels) the user exempted, e.g. API_KEY. */
  exceptedLabels: string[];
  presentation: Presentation;
  actions: Action[];
  /** Distinct categories detected, highest tier first. */
  categories: CategoryId[];
  /** Tier implied by detections alone, under the policy. */
  detectionTier: Tier;
  /** Tier implied by the context model alone (capped at MEDIUM). */
  contextTier: Tier;
}

const CONTEXT_LABEL_TIER: Record<string, Tier> = {
  safe: 'SAFE',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'MEDIUM', // capped — see header
};

export function contextTierOf(context: ClassifyResult | null | undefined): Tier {
  if (!context) return 'SAFE';
  if (context.uncertain) return 'MEDIUM';
  return CONTEXT_LABEL_TIER[context.top] ?? 'MEDIUM';
}

const PRESENTATION: Record<Tier, Presentation> = {
  SAFE: 'none',
  LOW: 'notice',
  MEDIUM: 'confirm',
  HIGH: 'block',
};

export interface DecideOptions {
  policy?: Policy;
  /** The user's unexpired exceptions; only what the policy allows is applied. */
  exceptions?: ActiveExceptions;
}

function minTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export function decide(
  detections: readonly Detection[],
  context?: ClassifyResult | null,
  options: DecideOptions = {},
): Decision {
  const policy = options.policy ?? DEFAULT_POLICY;
  const exceptions = options.exceptions ?? NO_EXCEPTIONS;

  let detectionTier: Tier = 'SAFE';
  let enforcedDetectionTier: Tier = 'SAFE';
  const excepted = new Set<CategoryId>();
  const exceptedLabels = new Set<string>();
  for (const d of detections) {
    const t = tierOfDetection(d, policy);
    detectionTier = maxTier(detectionTier, t);
    if (TIER_RANK[t] > TIER_RANK.LOW && isExempted(d, policy, exceptions)) {
      excepted.add(d.category);
      exceptedLabels.add(d.label);
      enforcedDetectionTier = maxTier(enforcedDetectionTier, minTier(t, 'LOW'));
    } else {
      enforcedDetectionTier = maxTier(enforcedDetectionTier, t);
    }
  }

  const contextTier = contextTierOf(context);
  const policyTier = maxTier(detectionTier, contextTier);
  const tier = maxTier(enforcedDetectionTier, contextTier);
  const canMask = detections.some((d) => !UNMASKED_CATEGORIES.has(d.category));

  const actions: Action[] = [];
  if (tier === 'SAFE' || tier === 'LOW') actions.push('send');
  if (tier === 'MEDIUM') actions.push('confirm_send');
  if (tier !== 'SAFE' && canMask) actions.push('send_masked');
  if (tier !== 'SAFE') actions.push('edit');
  if (tier === 'MEDIUM' || tier === 'HIGH') actions.push('cancel');

  const categories = [...new Set(detections.map((d) => d.category))].sort(
    (a, b) => TIER_RANK[tierUnderPolicy(b, policy)] - TIER_RANK[tierUnderPolicy(a, policy)],
  );

  return {
    tier,
    policyTier,
    exceptedCategories: [...excepted],
    exceptedLabels: [...exceptedLabels],
    presentation: PRESENTATION[tier],
    actions,
    categories,
    detectionTier,
    contextTier,
  };
}
