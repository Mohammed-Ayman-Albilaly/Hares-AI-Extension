/**
 * Hares AI — decision model for TOPIC rules, inside the dedicated worker.
 *
 * Loads the pinned zero-shot model once, and only when a policy with TOPIC
 * rules asks for it: a department without TOPIC rules never downloads it.
 * While it is downloading or loading, requests are answered at once with
 * status 'loading', so a send never waits on a first-run download; TOPIC rules
 * are simply not applied to those messages.
 *
 * Runs on the WASM (CPU) backend for the same reason as the detection model
 * (worker/ner.ts): the int8 model behaves the same on every machine.
 */

import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';
import type { ModelStatus } from '../src/messaging/protocol';
import { scoreTopics, TOPIC_MODEL, type TopicModel, type TopicTokenizer } from '../src/topics/runner';

const state = {
  status: 'idle' as ModelStatus,
  tokenizer: null as TopicTokenizer | null,
  model: null as TopicModel | null,
  error: null as string | null,
  loading: null as Promise<void> | null,
  lastAttemptAt: 0,
};

/** A failed load is tried again on a later request, at most once a minute. */
const RETRY_AFTER_MS = 60_000;

/** Start loading (idempotent). */
export function loadTopics(): Promise<void> {
  if (state.loading) return state.loading;
  state.status = 'loading';
  state.lastAttemptAt = Date.now();
  const started = performance.now();
  state.loading = (async () => {
    try {
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(TOPIC_MODEL.id, { revision: TOPIC_MODEL.revision }),
        AutoModelForSequenceClassification.from_pretrained(TOPIC_MODEL.id, {
          revision: TOPIC_MODEL.revision,
          dtype: TOPIC_MODEL.dtype,
          device: 'wasm',
        }),
      ]);
      state.tokenizer = tokenizer as unknown as TopicTokenizer;
      state.model = model as unknown as TopicModel;
      // Warm-up so the first real message is not slower.
      await scoreTopics(state.tokenizer, state.model, 'warm up', ['This text is a test.']);
      state.status = 'ready';
      console.info('[hares] topic model ready in %d ms (%s)', Math.round(performance.now() - started), TOPIC_MODEL.id);
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      state.loading = null; // allow a new attempt
      console.error('[hares] topic model failed to load:', state.error);
    }
  })();
  return state.loading;
}

export interface TopicsResult {
  status: ModelStatus;
  /** One score per hypothesis, in request order. Only when status is 'ready'. */
  scores?: number[];
  latencyMs?: number;
  error?: string;
}

/**
 * Score a message, or report why the model cannot run yet. Never waits for a
 * download. A request with no hypotheses only starts the loading (warm-up).
 */
export async function runTopics(text: string, hypotheses: readonly string[]): Promise<TopicsResult> {
  if (state.status === 'idle') void loadTopics();
  if (state.status === 'error' && Date.now() - state.lastAttemptAt >= RETRY_AFTER_MS) void loadTopics();
  if (state.status !== 'ready' || !state.tokenizer || !state.model) {
    return { status: state.status, error: state.error ?? undefined };
  }
  if (hypotheses.length === 0) return { status: 'ready', scores: [], latencyMs: 0 };
  const started = performance.now();
  const scores = await scoreTopics(state.tokenizer, state.model, text, hypotheses);
  return { status: 'ready', scores, latencyMs: Math.round(performance.now() - started) };
}
