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
 */

import {
  CATEGORIES,
  TIER_RANK,
  UNMASKED_CATEGORIES,
  maxTier,
  type CategoryId,
  type Tier,
} from '../detectors/categories';
import type { Detection } from '../detectors/types';
import type { ClassifyResult } from '../model/contract';

export type Action = 'send' | 'confirm_send' | 'send_masked' | 'edit' | 'cancel';

/** How the extension presents the decision (PDF 6.1.4.1–6.1.4.6). */
export type Presentation = 'none' | 'notice' | 'confirm' | 'block';

export interface Decision {
  tier: Tier;
  presentation: Presentation;
  actions: Action[];
  /** Distinct categories detected, highest tier first. */
  categories: CategoryId[];
  /** Tier implied by detections alone. */
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

export function decide(
  detections: readonly Detection[],
  context?: ClassifyResult | null,
): Decision {
  const detectionTier = detections.reduce<Tier>(
    (tier, d) => maxTier(tier, CATEGORIES[d.category].tier),
    'SAFE',
  );
  const contextTier = contextTierOf(context);
  const tier = maxTier(detectionTier, contextTier);
  const canMask = detections.some((d) => !UNMASKED_CATEGORIES.has(d.category));

  const actions: Action[] = [];
  if (tier === 'SAFE' || tier === 'LOW') actions.push('send');
  if (tier === 'MEDIUM') actions.push('confirm_send');
  if (tier !== 'SAFE' && canMask) actions.push('send_masked');
  if (tier !== 'SAFE') actions.push('edit');
  if (tier === 'MEDIUM' || tier === 'HIGH') actions.push('cancel');

  const categories = [...new Set(detections.map((d) => d.category))].sort(
    (a, b) => TIER_RANK[CATEGORIES[b].tier] - TIER_RANK[CATEGORIES[a].tier],
  );

  return { tier, presentation: PRESENTATION[tier], actions, categories, detectionTier, contextTier };
}
