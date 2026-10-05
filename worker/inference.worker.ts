/**
 * Hares AI — Phase 2 dedicated Web Worker: inference runtime.
 *
 * Phase 2 establishes the local ONNX inference runtime inside the existing
 * Phase 1 worker. It loads the pinned multilingual zero-shot model via
 * Transformers.js (ONNX Runtime Web), preferring the WebGPU execution provider
 * and falling back to WASM SIMD, and exposes the minimal `classify(prompt)`
 * contract. This step only executes the local model; it introduces no risk-tier
 * decision logic, policy, warnings, interception, or product behaviour.
 *
 * Local-only guarantee: the worker loads model/runtime artifacts over the
 * network during this bootstrap spike. It sends no prompt text anywhere — the
 * model download is the only network traffic and never carries user content.
 */

import {
  env,
  pipeline,
  type ZeroShotClassificationPipeline,
} from '@huggingface/transformers';
import {
  MSG,
  type WorkerClassifyRequest,
  type WorkerClassifyResult,
  type WorkerProbeMessage,
  type WorkerProbeResult,
} from '../src/messaging/protocol';
import type { ClassifyResult } from '../src/model/contract';
import {
  HYPOTHESES,
  HYPOTHESIS_TEMPLATE,
  MODEL,
  UNCERTAINTY_THRESHOLD,
} from '../src/model/config';

// --- ONNX Runtime configuration ----------------------------------------------
// Point the ONNX Runtime at locally bundled WASM assets so the extension never
// depends on a runtime CDN fetch for runtime code. These assets are copied into
// the build output (see wxt.config.ts) and served from the extension origin.
const RUNTIME_ASSET_BASE = `${self.location.origin}/wasm/`;
const wasmConfig = env.backends.onnx.wasm;
if (wasmConfig) {
  wasmConfig.wasmPaths = RUNTIME_ASSET_BASE;
}

// The bootstrap spike may download model artifacts from Hugging Face. Prompt
// text is never sent anywhere; only model/runtime artifacts are fetched.
env.allowRemoteModels = true;

// --- Runtime state ------------------------------------------------------------
type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';
type ExecutionProvider = 'webgpu' | 'wasm';

const runtime = {
  classifier: null as ZeroShotClassificationPipeline | null,
  status: 'idle' as RuntimeStatus,
  provider: null as ExecutionProvider | null,
  error: null as string | null,
  init: null as Promise<void> | null,
};

// The worker has no `window`, so type `self` explicitly for messaging.
const scope = self as unknown as {
  postMessage(message: WorkerProbeResult | WorkerClassifyResult): void;
  addEventListener(
    type: 'message',
    listener: (
      event: MessageEvent<WorkerProbeMessage | WorkerClassifyRequest>,
    ) => void,
  ): void;
};

scope.addEventListener('message', (event) => {
  const message = event.data;

  if (message?.type === MSG.PROBE) {
    // Phase 1 compatibility: answer the round-trip probe immediately,
    // independent of the model-load state.
    const result: WorkerProbeResult = {
      type: MSG.PROBE_RESULT,
      id: message.id,
      ok: true,
      result: 'worker-ok',
    };
    scope.postMessage(result);
    return;
  }

  if (message?.type === MSG.CLASSIFY) {
    void handleClassify(message);
  }
});

// Announce readiness so a connected offscreen document can log it.
scope.postMessage({
  type: MSG.PROBE_RESULT,
  id: 'init',
  ok: true,
  result: 'worker-ready',
});

/**
 * Initialize the local inference runtime: load the pinned model, preferring
 * WebGPU and falling back to WASM SIMD. Idempotent — concurrent callers share
 * a single init promise.
 */
export function initializeRuntime(): Promise<void> {
  if (runtime.init) {
    return runtime.init;
  }

  runtime.status = 'loading';
  runtime.init = (async () => {
    try {
      runtime.classifier = await loadPipeline('webgpu');
      runtime.provider = 'webgpu';
      runtime.status = 'ready';
      console.info(
        '[hares] inference runtime ready (provider=webgpu, model=%s@%s)',
        MODEL.id,
        MODEL.revision,
      );
    } catch (webgpuError) {
      console.warn('[hares] WebGPU init failed; falling back to WASM:', webgpuError);
      try {
        runtime.classifier = await loadPipeline('wasm');
        runtime.provider = 'wasm';
        runtime.status = 'ready';
        console.info(
          '[hares] inference runtime ready (provider=wasm, model=%s@%s)',
          MODEL.id,
          MODEL.revision,
        );
      } catch (wasmError) {
        runtime.status = 'error';
        runtime.error = wasmError instanceof Error ? wasmError.message : String(wasmError);
        console.error('[hares] inference runtime failed to initialize:', runtime.error);
        throw wasmError;
      }
    }
  })();

  return runtime.init;
}

type ZeroShotLoader = (
  task: 'zero-shot-classification',
  model: string,
  options: {
    revision: string;
    dtype: string;
    device: string;
  },
) => Promise<unknown>;

const loadZeroShot = pipeline as unknown as ZeroShotLoader;

function loadPipeline(
  device: ExecutionProvider,
): Promise<ZeroShotClassificationPipeline> {
  return loadZeroShot('zero-shot-classification', MODEL.id, {
    revision: MODEL.revision,
    dtype: MODEL.dtype,
    device,
  }) as Promise<ZeroShotClassificationPipeline>;
}
/** Resolve the initialized classifier, waiting on the shared init promise. */
async function getClassifier(): Promise<ZeroShotClassificationPipeline> {
  await initializeRuntime();
  const classifier = runtime.classifier;
  if (!classifier) {
    throw new Error(runtime.error ?? 'Inference runtime is not ready');
  }
  return classifier;
}

/**
 * Classify a prompt and return the four-label score distribution.
 *
 * Preserves the NLI `multi_class=false` semantics: the model scores entailment
 * for each candidate hypothesis in a single batched forward pass, then we softmax
 * over the entailment logits across the candidate labels. The result is a raw
 * model output with no risk-tier mapping.
 */
export async function classify(prompt: string): Promise<ClassifyResult> {
  const classifier = await getClassifier();
  return runClassification(classifier, prompt);
}

type PipelineInternals = {
  tokenizer: {
    (text: string): { input_ids: { data: { length: number } } };
    (
      texts: string[],
      options: { text_pair: string[]; padding: boolean; truncation: boolean },
    ): unknown;
  };
  model: (inputs: unknown) => Promise<{
    logits: { data: ArrayLike<number>; dims: number[] };
  }>;
  entailment_id: number;
};

async function runClassification(
  classifier: ZeroShotClassificationPipeline,
  prompt: string,
): Promise<ClassifyResult> {
  const started = performance.now();
  const pipe = classifier as unknown as PipelineInternals;

  const hypotheses = HYPOTHESES.map((h) => HYPOTHESIS_TEMPLATE.replace('{}', h.text));

  // Batch all four (premise, hypothesis) pairs into a single forward pass.
  const inputs = pipe.tokenizer(
    hypotheses.map(() => prompt),
    { text_pair: hypotheses, padding: true, truncation: true },
  );
  const outputs = await pipe.model(inputs);

  const logits = outputs.logits;
  const numLabels = logits.dims[1] ?? 0;
  const entailmentId = Number.isFinite(pipe.entailment_id) ? pipe.entailment_id : 1;

  // Collect the entailment logit for each candidate label (multi_class=false).
  const entails: number[] = [];
  for (let i = 0; i < (logits.dims[0] ?? 0); i += 1) {
    entails.push(Number(logits.data[i * numLabels + entailmentId]));
  }

  // Softmax over entailment logits across the four candidate labels.
  const scores = softmax(entails);
  const ranked = scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score);
  const labels = ranked.map(({ i }) => HYPOTHESES[i]?.id ?? String(i));
  const scoresOut = ranked.map(({ score }) => score);
  const top = labels[0] ?? '';
  const top_score = scoresOut[0] ?? 0;

  const enc = pipe.tokenizer(prompt);
  const input_tokens = enc.input_ids.data.length;
  const latency_ms = Math.round(performance.now() - started);
  const uncertain = top_score < UNCERTAINTY_THRESHOLD;

  return { labels, scores: scoresOut, top, top_score, input_tokens, latency_ms, uncertain };
}

function softmax(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / sum);
}

async function handleClassify(request: WorkerClassifyRequest): Promise<void> {
  try {
    const result = await classify(request.prompt);
    const payload: WorkerClassifyResult = {
      type: MSG.CLASSIFY_RESULT,
      id: request.id,
      ok: true,
      result,
    };
    scope.postMessage(payload);
  } catch (error) {
    const payload: WorkerClassifyResult = {
      type: MSG.CLASSIFY_RESULT,
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(payload);
  }
}

// Bootstrap the runtime as soon as the worker is created by the offscreen
// document. The worker is a single shared instance, so this runs exactly once.
void initializeRuntime().catch((error: unknown) => {
  console.error('[hares] worker bootstrap init failed:', error);
});
