/**
 * Determinism flag used by the evaluation/QA path.
 *
 * When true, the inference host is expected to force a single-threaded
 * CPU/WASM execution provider so the same prompt always yields the same tier.
 * Phase 1 defines the flag only; no inference runtime consumes it yet.
 */
export const TEST_MODE = false;
