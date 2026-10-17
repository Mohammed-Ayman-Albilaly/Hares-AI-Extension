/**
 * Hares AI — Stage 1 rule detector (docs/Hares AI.pdf Algorithm 15.1).
 *
 * Runs every pattern in src/detectors/patterns.ts over the prompt, keeps the
 * matches that pass their validator, and returns de-overlapped detections
 * sorted by start offset. Pure and synchronous; it needs no model, so it keeps
 * working when the model stages fail.
 */

import { DEFAULT_POLICY } from '../policy/defaults';
import type { CustomKeyword, Policy } from '../policy/types';
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

/** Escape text for literal use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A policy custom keyword as a literal, case-insensitive pattern. Word
 * boundaries are added only on Latin word edges (JS `\b` does not understand
 * Arabic letters).
 */
function keywordPattern(keyword: CustomKeyword, index: number): PatternSpec {
  const body = escapeRegExp(keyword.text).replace(/\s+/g, String.raw`\s+`);
  const start = /^\w/.test(keyword.text) ? String.raw`\b` : '';
  const end = /\w$/.test(keyword.text) ? String.raw`\b` : '';
  return {
    id: `custom-keyword-${index}`,
    category: keyword.category,
    label: keyword.label,
    source: `${start}${body}${end}`,
    flags: 'i',
  };
}

/** Patterns in effect under a policy: built-ins minus disabled ones, plus custom keywords. */
export function patternsForPolicy(policy: Policy): PatternSpec[] {
  const disabled = new Set(policy.rules?.disabledPatterns ?? []);
  const builtIn = PATTERNS.filter((p) => !disabled.has(p.id));
  const custom = (policy.rules?.customKeywords ?? []).map(keywordPattern);
  return [...builtIn, ...custom];
}

/** Compiled patterns are cached per policy object (policies are replaced, never mutated). */
const compiledByPolicy = new WeakMap<Policy, CompiledPattern[]>();

function compiledFor(policy: Policy): CompiledPattern[] {
  let compiled = compiledByPolicy.get(policy);
  if (!compiled) {
    compiled = compile(patternsForPolicy(policy));
    compiledByPolicy.set(policy, compiled);
  }
  return compiled;
}

/** Placeholders written by the vault, e.g. `[EMAIL_1]`, `[API_KEY_12]`. */
const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

/**
 * Spans of existing placeholders. Detections touching them are dropped so an
 * already-masked prompt (`password is [PASSWORD_1]`) is not flagged again.
 */
function placeholderSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => [m.index, m.index + m[0].length]);
}

export function detectWithRules(text: string, policy: Policy = DEFAULT_POLICY): Detection[] {
  const compiled = compiledFor(policy);
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
