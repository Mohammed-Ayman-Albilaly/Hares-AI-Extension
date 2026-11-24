/**
 * Hares AI — content-script side of the TOPIC decision model.
 *
 * Asks the background (→ offscreen → worker) to score a message against the
 * policy's topic descriptions, with a hard timeout. Like the detection model
 * (src/ner/client.ts) it never throws and never blocks the user: if the model
 * is still downloading, failed, or is slow, the caller gets no scores and the
 * message is checked without TOPIC rules.
 */

import { browser } from 'wxt/browser';
import { MSG, TARGET, type ModelStatus, type TopicsRequest, type TopicsResponse } from '../messaging/protocol';

/**
 * How long a send may wait for the topic scores. In Chrome the scoring took 1
 * to 2 seconds with two rules, and several times that on a model left idle, so
 * the limit leaves room: past it the topic is silently missed.
 */
export const TOPICS_TIMEOUT_MS = 6000;

export type TopicsOutcome = ModelStatus | 'timeout';

export interface TopicScoresResult {
  outcome: TopicsOutcome;
  /** One score per hypothesis, in request order; empty unless the outcome is 'ready'. */
  scores: number[];
  latencyMs?: number;
}

export async function requestTopicScores(
  text: string,
  hypotheses: readonly string[],
  timeoutMs = TOPICS_TIMEOUT_MS,
): Promise<TopicScoresResult> {
  const request: TopicsRequest = { target: TARGET.BACKGROUND, type: MSG.TOPICS, id: crypto.randomUUID(), text, hypotheses: [...hypotheses] };
  const timeout = new Promise<TopicScoresResult>((resolve) =>
    setTimeout(() => resolve({ outcome: 'timeout', scores: [] }), timeoutMs),
  );
  const ask = (async (): Promise<TopicScoresResult> => {
    try {
      const response = (await browser.runtime.sendMessage(request)) as TopicsResponse | undefined;
      if (!response) return { outcome: 'error', scores: [] };
      const scores = response.status === 'ready' && Array.isArray(response.scores) ? response.scores : [];
      // A reply that does not line up with the request cannot be trusted.
      if (response.status === 'ready' && scores.length !== hypotheses.length) return { outcome: 'error', scores: [] };
      return { outcome: response.status, scores, latencyMs: response.latencyMs };
    } catch {
      return { outcome: 'error', scores: [] };
    }
  })();
  return Promise.race([ask, timeout]);
}

/**
 * Get the model ready before the user's message: start loading it, or, if it
 * has sat idle, run it once so the real scoring is not the slow first one.
 */
export function warmUpTopicModel(): void {
  void requestTopicScores('', [], TOPICS_TIMEOUT_MS);
}
