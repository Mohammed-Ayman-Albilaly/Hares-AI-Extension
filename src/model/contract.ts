/**
 * Hares AI — Phase 2 inference contract.
 *
 * The shape returned by `classify(prompt)` in the inference worker and relayed
 * to the extension through the Offscreen document. It is a raw model result —
 * it intentionally contains no SAFE/LOW/MEDIUM/HIGH risk-tier or policy
 * mapping; that belongs to a later phase.
 */

export interface ClassifyResult {
  /**
   * Model label ids in descending score order, e.g. `['safe', 'low', ...]`.
   * Ids are the four baseline hypothesis ids from src/model/config.ts.
   */
  labels: string[];
  /** Scores parallel to `labels`, each in [0, 1]. */
  scores: number[];
  /** The argmax label id (`labels[0]`). */
  top: string;
  /** The argmax score (`scores[0]`). */
  top_score: number;
  /** Number of prompt tokens used by the tokenizer. */
  input_tokens: number;
  /** Measured inference latency in milliseconds (single batched forward pass). */
  latency_ms: number;
  /**
   * Whether the model's own top score is below the uncertainty threshold. A
   * raw model-output property only — escalation to a MEDIUM tier is policy and
   * lives in a later phase.
   */
  uncertain: boolean;
}
