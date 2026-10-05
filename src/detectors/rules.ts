/**
 * Hares AI — Stage 1 rule detector (docs/Hares AI.pdf Algorithm 15.1).
 *
 * Runs every pattern in src/detectors/patterns.ts over the prompt, keeps the
 * matches that pass their validator, and returns de-overlapped detections
 * sorted by start offset. Pure and synchronous; it needs no model, so it keeps
 * working when the model stages fail.
 */

import { mergeDetections } from './merge';
import { PATTERNS, type PatternSpec } from './patterns';
import type { Detection } from './types';
import { VALIDATORS } from './validators';

/**
 * Map Arabic-Indic (U+0660–0669) and Extended Arabic-Indic / Persian
 * (U+06F0–06F9) digits to ASCII. One UTF-16 unit in, one out, so offsets in the
 * normalized string are valid offsets in the original.
 */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

interface CompiledPattern {
  spec: PatternSpec;
  regex: RegExp;
}

function compile(patterns: readonly PatternSpec[]): CompiledPattern[] {
  return patterns.map((spec) => {
    const flags = new Set(`gd${spec.flags ?? ''}`);
    return { spec, regex: new RegExp(spec.source, [...flags].join('')) };
  });
}

let compiledDefault: CompiledPattern[] | null = null;

/** Placeholders written by the vault, e.g. `[EMAIL_1]`, `[API_KEY_12]`. */
const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

/**
 * Spans of existing placeholders. Detections touching them are dropped so an
 * already-masked prompt (`password is [PASSWORD_1]`) is not flagged again.
 */
function placeholderSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => [m.index, m.index + m[0].length]);
}

export function detectWithRules(
  text: string,
  patterns: readonly PatternSpec[] = PATTERNS,
): Detection[] {
  const compiled =
    patterns === PATTERNS ? (compiledDefault ??= compile(PATTERNS)) : compile(patterns);
  const normalized = normalizeDigits(text);
  const placeholders = placeholderSpans(text);
  const found: Detection[] = [];

  for (const { spec, regex } of compiled) {
    regex.lastIndex = 0;
    for (const match of normalized.matchAll(regex)) {
      const span = match.indices?.[spec.group ?? 0];
      if (!span) continue;
      const [start, end] = span;
      const matched = normalized.slice(start, end);
      if (spec.validate && !VALIDATORS[spec.validate](matched)) continue;
      if (placeholders.some(([ps, pe]) => start < pe && ps < end)) continue;
      found.push({
        category: spec.category,
        label: spec.label,
        value: text.slice(start, end),
        start,
        end,
        source: 'rule',
        confidence: 1,
      });
    }
  }

  return mergeDetections(found);
}
