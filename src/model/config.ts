/**
 * Hares AI — Phase 2 inference runtime model configuration.
 *
 * Minimal configuration for the local inference runtime. It holds the pinned
 * model identity/revision and the four baseline zero-shot hypotheses from
 * docs/system-design.md §5. It intentionally contains no risk-tier policy and
 * no SAFE/LOW/MEDIUM/HIGH mapping (that belongs to a later phase).
 */

export const MODEL = {
  /** Hugging Face model id. */
  id: 'Horizon-Labs/multilingual-zeroshot-small',
  /**
   * Exact pinned revision/ref for the model artifact. MUST stay an immutable
   * ref; never use `latest`, `main`, or any other mutable alias.
   */
  revision: 'v1.3' as const,
  /** ONNX dtype requested from the hub (quantized int8 for the browser). */
  dtype: 'q8' as const,
} as const;

/**
 * Hypothesis template passed to the NLI zero-shot pipeline. The model card
 * (`not_entailment (0)` / `entailment (1)`) states the model scores whether the
 * prompt text entails "This example is {label}." so the template has a single
 * `{}` slot for the label. The two-slot template in docs/system-design.md §5
 * cannot be used with the Transformers.js pipeline, which fills only the first
 * `{}`. The prompt itself is supplied as the NLI premise.
 */
export const HYPOTHESIS_TEMPLATE = 'This example is {}.';

/** The model's own top score below which the output is treated as uncertain. */
export const UNCERTAINTY_THRESHOLD = 0.4;

/** Preserve the NLI pipeline's single-label semantics (multi_class=false). */
export const MULTI_CLASS = false;

/** The four baseline hypotheses from docs/system-design.md §5. */
export const HYPOTHESES = [
  { id: 'safe', text: 'This prompt contains no sensitive information.' },
  {
    id: 'low',
    text: 'This prompt contains a small amount of personal or sensitive information.',
  },
  {
    id: 'medium',
    text: 'This prompt contains sensitive personal or private information.',
  },
  {
    id: 'high',
    text: 'This prompt contains highly sensitive information such as credentials, national IDs, financial or health records, or internal secrets.',
  },
] as const;
