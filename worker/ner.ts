/**
 * Hares AI — detection model runtime inside the dedicated worker.
 *
 * Loads Horizon-Labs/pii-redactor-small once (pinned revision, int8) and runs
 * it on request. While it is still downloading/loading, requests are answered
 * immediately with status 'loading' so the extension never waits on a first-run
 * download — it falls back to the rules for those messages.
 *
 * Runs on the WASM (CPU) backend: the int8 model is small enough for CPU
 * (~70–150 ms per prompt measured in Node), and WASM behaves the same on every
 * machine, unlike WebGPU support for int8 kernels.
 */

import { AutoModelForTokenClassification, AutoTokenizer } from '@huggingface/transformers';
import type { ModelStatus } from '../src/messaging/protocol';
import { detectEntities, NER_MODEL, type NerModel, type NerTokenizer } from '../src/ner/runner';
import type { EntitySpan } from '../src/ner/spans';

const state = {
  status: 'idle' as ModelStatus,
  tokenizer: null as NerTokenizer | null,
  model: null as NerModel | null,
  error: null as string | null,
  loading: null as Promise<void> | null,
  attempts: 0,
  lastAttemptAt: 0,
};

/**
 * A failed load (usually a dropped or blocked download) is retried with
 * backoff instead of leaving the model off until the browser restarts.
 */
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000];

function scheduleRetry(): void {
  const delay = RETRY_DELAYS_MS[Math.min(state.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 15 * 60_000;
  setTimeout(() => {
    if (state.status === 'error') void loadNer();
  }, delay);
  console.info('[hares] detection model: retrying in %d s', Math.round(delay / 1000));
}

export function nerStatus(): ModelStatus {
  return state.status;
}

/** Start loading (idempotent). */
export function loadNer(): Promise<void> {
  if (state.loading) return state.loading;
  state.status = 'loading';
  state.attempts += 1;
  state.lastAttemptAt = Date.now();
  const started = performance.now();
  state.loading = (async () => {
    try {
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(NER_MODEL.id, { revision: NER_MODEL.revision }),
        AutoModelForTokenClassification.from_pretrained(NER_MODEL.id, {
          revision: NER_MODEL.revision,
          dtype: NER_MODEL.dtype,
          device: 'wasm',
        }),
      ]);
      state.tokenizer = tokenizer as unknown as NerTokenizer;
      state.model = model as unknown as NerModel;
      // Warm-up so the first real prompt is not slower.
      await detectEntities(state.tokenizer, state.model, 'warm up');
      state.status = 'ready';
      console.info('[hares] detection model ready in %d ms (%s)', Math.round(performance.now() - started), NER_MODEL.id);
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : String(error);
      state.loading = null; // allow a new attempt
      console.error('[hares] detection model failed to load (attempt %d):', state.attempts, state.error);
      scheduleRetry();
    }
  })();
  return state.loading;
}

export interface NerResult {
  status: ModelStatus;
  entities?: EntitySpan[];
  latencyMs?: number;
  error?: string;
}

/** Run the model, or report why it cannot run yet. Never waits for a download. */
export async function runNer(text: string): Promise<NerResult> {
  if (state.status === 'idle') void loadNer();
  // A message after a failed load triggers an early retry, at most once a minute.
  if (state.status === 'error' && Date.now() - state.lastAttemptAt >= 60_000) void loadNer();
  if (state.status !== 'ready' || !state.tokenizer || !state.model) {
    return { status: state.status, error: state.error ?? undefined };
  }
  const started = performance.now();
  const entities = await detectEntities(state.tokenizer, state.model, text);
  return { status: 'ready', entities, latencyMs: Math.round(performance.now() - started) };
}
