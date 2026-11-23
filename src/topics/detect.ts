/**
 * Hares AI — turn the decision model's topic scores into detections.
 *
 * A TOPIC rule matches when its score reaches the rule's threshold. The match
 * is a Detection like a KEYWORD or PATTERN match (same internal category, same
 * rule id, risk and action), with one difference: it is about the message as a
 * whole, so there is nothing to mask and the revised message cannot fix it.
 */

import { tierFromAction, tierFromRisk } from '../contract/enums';
import type { Detection } from '../detectors/types';
import type { TopicRule } from './rules';

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
        enforce: tierFromAction(topic.rule.action),
        order: topic.order,
      },
    });
  });
  return found;
}
