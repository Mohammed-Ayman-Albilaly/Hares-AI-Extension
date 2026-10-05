/**
 * Hares AI — local analysis pipeline (Phase 1: rules only).
 *
 * rules → mask (vault) → decide. Synchronous and model-free, so it can run
 * directly in the content script. Model stages (NER, context classifier) are
 * added later in the offscreen worker and merged into the same result shape.
 */

import {
  CATEGORIES,
  TIER_RANK,
  UNMASKED_CATEGORIES,
  type CategoryId,
  type Tier,
} from '../detectors/categories';
import { mergeDetections } from '../detectors/merge';
import { detectWithRules } from '../detectors/rules';
import type { Detection } from '../detectors/types';
import { PlaceholderVault } from '../masking/vault';
import type { ClassifyResult } from '../model/contract';
import { decide, type Decision } from '../policy/decision';

/** One detected item as shown to the user — never carries the raw value. */
export interface FindingSummary {
  category: CategoryId;
  categoryName: string;
  tier: Tier;
  /** `[EMAIL_1]`, or null for report-only detections (keywords). */
  placeholder: string | null;
  /** Completes a value from the previous message. */
  crossesMessages: boolean;
}

export interface AnalysisResult {
  original: string;
  /** The prompt with every maskable detection replaced by a placeholder. */
  revised: string;
  detections: Detection[];
  findings: FindingSummary[];
  decision: Decision;
  latencyMs: number;
}

function summarize(detections: readonly Detection[], vault: PlaceholderVault): FindingSummary[] {
  const seen = new Set<string>();
  const findings: FindingSummary[] = [];
  for (const d of detections) {
    const placeholder = UNMASKED_CATEGORIES.has(d.category)
      ? null
      : vault.placeholderFor(d.label, d.value);
    const key = placeholder ?? `${d.category}:${d.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      category: d.category,
      categoryName: CATEGORIES[d.category].name,
      tier: CATEGORIES[d.category].tier,
      placeholder,
      crossesMessages: d.crossesMessages === true,
    });
  }
  return findings.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
}

/**
 * Detections that need the previous message: a value split across messages, or
 * announced at the end of it ("my password is" → next message "Hunter2!").
 * The previous tail is joined to the prompt; only the part of each detection
 * inside the current prompt is kept (the rest was already sent).
 */
function detectAcrossMessages(prompt: string, historyTail: string): Detection[] {
  // Joined with a space (not a newline) so a number split across messages
  // ("4111 1111" + "1111 1111") still matches as one value.
  const offset = historyTail.length + 1;
  const combined = `${historyTail} ${prompt}`;
  const result: Detection[] = [];
  for (const d of detectWithRules(combined)) {
    if (d.end <= offset) continue; // entirely in the previous message
    const start = Math.max(d.start, offset) - offset;
    const end = d.end - offset;
    result.push({ ...d, start, end, value: prompt.slice(start, end), crossesMessages: true });
  }
  return result;
}

export interface AnalyzeOptions {
  /** Context-model result (later phase). */
  context?: ClassifyResult | null;
  /** Tail of the last message sent in this conversation. */
  historyTail?: string;
}

export function analyzePrompt(
  prompt: string,
  vault: PlaceholderVault,
  options: AnalyzeOptions = {},
): AnalysisResult {
  const started = performance.now();
  const own = detectWithRules(prompt);
  const detections = options.historyTail
    ? mergeDetections([...own, ...detectAcrossMessages(prompt, options.historyTail)]).map(
        // A span found on its own is not "cross-message", even if the joined text also found it.
        (d) => (own.some((o) => o.start === d.start && o.end === d.end) ? { ...d, crossesMessages: undefined } : d),
      )
    : own;
  const context = options.context;
  const { masked } = vault.mask(prompt, detections);
  const decision = decide(detections, context);
  return {
    original: prompt,
    revised: masked,
    detections,
    findings: summarize(detections, vault),
    decision,
    latencyMs: Math.round(performance.now() - started),
  };
}
