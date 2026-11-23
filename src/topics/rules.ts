/**
 * Hares AI — TOPIC rules of the policy.
 *
 * A TOPIC rule names a subject in words ("plans to lay off employees"). The
 * local decision model reads the user's message and the rule's English
 * description and returns a score from 0 to 1; the rule matches when the score
 * reaches the rule's threshold.
 *
 * Measured on 80 Arabic and English prompts (docs/topic-rules.md): an English
 * description catches most Arabic prompts, an Arabic one does not, which is why
 * the English text is required. The platform validates both fields; the checks
 * here are the extension's own guard, because rules saved before the fields
 * existed arrive with `definition_en: null`.
 */

import type { OrgRule, Policy } from '../policy/types';

export const TOPIC_DESCRIPTION_MIN = 20;
export const TOPIC_DESCRIPTION_MAX = 300;
export const TOPIC_THRESHOLD_MIN = 0.2;
export const TOPIC_THRESHOLD_MAX = 0.9;
/** Catches short prompts (which score around 0.35) at the cost of some near-topic alerts. */
export const TOPIC_THRESHOLD_DEFAULT = 0.3;
/** The platform caps TOPIC rules per department at 10; anything beyond is not scored. */
export const MAX_TOPIC_RULES = 10;

/**
 * The usable form of a TOPIC rule's two fields, or null when the rule cannot be
 * enforced (no English description, or one outside the length limits). A
 * missing threshold takes the default; one outside the range is moved to the
 * nearest limit.
 */
export function parseTopicFields(
  definitionEn: unknown,
  threshold: unknown,
): { definitionEn: string; threshold: number } | null {
  if (typeof definitionEn !== 'string') return null;
  const text = definitionEn.trim();
  if (text.length < TOPIC_DESCRIPTION_MIN || text.length > TOPIC_DESCRIPTION_MAX) return null;
  const value =
    typeof threshold === 'number' && Number.isFinite(threshold)
      ? Math.min(TOPIC_THRESHOLD_MAX, Math.max(TOPIC_THRESHOLD_MIN, threshold))
      : TOPIC_THRESHOLD_DEFAULT;
  return { definitionEn: text, threshold: value };
}

export interface TopicRule {
  rule: OrgRule;
  /** Position among all organisation rules of the bundle: breaks ties between matched rules. */
  order: number;
  /** The sentence the model judges the message against. */
  hypothesis: string;
  threshold: number;
}

/** The TOPIC rules of a policy that can be enforced, in bundle order. */
export function topicRulesOf(policy: Policy): TopicRule[] {
  const topics: TopicRule[] = [];
  (policy.rules?.org ?? []).forEach((rule, order) => {
    if (rule.kind !== 'TOPIC' || !rule.definitionEn) return;
    if (topics.length >= MAX_TOPIC_RULES) return;
    topics.push({ rule, order, hypothesis: rule.definitionEn, threshold: rule.threshold ?? TOPIC_THRESHOLD_DEFAULT });
  });
  return topics;
}
