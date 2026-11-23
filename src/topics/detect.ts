/**
 * Hares AI — turn the decision model's topic scores into detections.
 *
 * A TOPIC rule matches when its score reaches the rule's threshold. The match
 * is a Detection like a KEYWORD or PATTERN match (same internal category, same
 * rule id, risk and action), with one difference: it is about the message as a
 * whole, so there is nothing to mask and the revised message cannot fix it.
 *
 * A TOPIC rule never blocks. The model's answer is a likelihood, not a fact
 * like a card number, and a wrong block stops someone's work with nothing they
 * can mask to get past it. A rule that arrives with the action BLOCK is
 * therefore enforced, and logged, as WARN.
 */

import { tierFromAction, tierFromRisk } from '../contract/enums';
import { TIER_RANK, type Tier } from '../detectors/categories';
import type { Detection } from '../detectors/types';
import type { TopicRule } from './rules';

/** The strongest thing a TOPIC rule can do: warn (the confirm dialog). */
export const TOPIC_MAX_ENFORCEMENT: Tier = 'MEDIUM';

function capped(tier: Tier): Tier {
  return TIER_RANK[tier] > TIER_RANK[TOPIC_MAX_ENFORCEMENT] ? TOPIC_MAX_ENFORCEMENT : tier;
}

export function topicDetections(topics: readonly TopicRule[], scores: readonly number[]): Detection[] {
  const found: Detection[] = [];
  topics.forEach((topic, i) => {
    const score = scores[i];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < topic.threshold) return;
    found.push({
      category: 'ORG_RULE',
      label: 'TOPIC',
      // No text is carried: the match is not a span of the message.
      value: '',
      start: 0,
      end: 0,
      source: 'topic',
      confidence: score,
      wholeMessage: true,
      rule: {
        id: topic.rule.id,
        name: topic.rule.name,
        risk: tierFromRisk(topic.rule.risk),
        enforce: capped(tierFromAction(topic.rule.action)),
        order: topic.order,
      },
    });
  });
  return found;
}
