/**
 * Hares AI — organisation rules from the policy bundle (KEYWORD and PATTERN).
 *
 * - PATTERN: compiled with the flag `i` only, as the contract requires. The
 *   flag `g` is added to scan the whole text; it does not change what matches.
 *   A definition that does not compile is skipped, never thrown on.
 * - KEYWORD: one word or phrase per line, matched as whole words on normalised
 *   text (see ./text.ts). A phrase matches consecutive words with any
 *   whitespace or punctuation between them.
 * - TOPIC rules are not enforced by the extension and are dropped before this point.
 *
 * A rule match is a Detection in the internal ORG_RULE category: it can be
 * masked like any other, and carries the rule's id, risk and enforcement level.
 */

import { tierFromAction, tierFromRisk } from '../contract/enums';
import type { Detection } from '../detectors/types';
import type { OrgRule, Policy } from '../policy/types';
import { normalizeKeyword, normalizeWithMap } from './text';

/** Matches kept per rule per message: bounds the work on a pasted document. */
const MAX_MATCHES_PER_RULE = 50;
export const MAX_PATTERN_LENGTH = 512;

/** Letters, marks, digits and underscore: what a keyword must not be glued to. */
const WORD_CHAR = String.raw`\p{L}\p{M}\p{N}_`;
const SEPARATOR = `[^${WORD_CHAR}]+`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CompiledRule {
  rule: OrgRule;
  order: number;
  kind: 'PATTERN' | 'KEYWORD';
  regex: RegExp;
}

/** One alternative per keyword line: its words joined by separators. */
export function keywordSource(definition: string): string | null {
  const phrases = definition
    .split(/\r?\n/)
    .map((line) =>
      normalizeKeyword(line)
        .split(new RegExp(SEPARATOR, 'u'))
        .filter((w) => w.length > 0)
        .map(escapeRegExp)
        .join(SEPARATOR),
    )
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
  if (phrases.length === 0) return null;
  return `(?<![${WORD_CHAR}])(?:${phrases.join('|')})(?![${WORD_CHAR}])`;
}

function compileRule(rule: OrgRule, order: number): CompiledRule | null {
  try {
    if (rule.kind === 'PATTERN') {
      if (rule.definition.length === 0 || rule.definition.length > MAX_PATTERN_LENGTH) return null;
      return { rule, order, kind: 'PATTERN', regex: new RegExp(rule.definition, 'gi') };
    }
    const source = keywordSource(rule.definition);
    return source ? { rule, order, kind: 'KEYWORD', regex: new RegExp(source, 'gu') } : null;
  } catch {
    return null;
  }
}

/** Compiled rules are cached per policy object (policies are replaced, never mutated). */
const compiledByPolicy = new WeakMap<Policy, CompiledRule[]>();

function compiledFor(policy: Policy): CompiledRule[] {
  let compiled = compiledByPolicy.get(policy);
  if (!compiled) {
    compiled = (policy.rules?.org ?? []).flatMap((rule, order) => compileRule(rule, order) ?? []);
    compiledByPolicy.set(policy, compiled);
  }
  return compiled;
}

function toDetection(c: CompiledRule, value: string, start: number, end: number): Detection {
  return {
    category: 'ORG_RULE',
    label: 'RULE',
    value,
    start,
    end,
    source: 'rule',
    confidence: 1,
    rule: {
      id: c.rule.id,
      name: c.rule.name,
      risk: tierFromRisk(c.rule.risk),
      enforce: tierFromAction(c.rule.action),
      order: c.order,
    },
  };
}

export function detectWithOrgRules(text: string, policy: Policy): Detection[] {
  const compiled = compiledFor(policy);
  if (compiled.length === 0) return [];
  const normalized = compiled.some((c) => c.kind === 'KEYWORD') ? normalizeWithMap(text) : null;
  const found: Detection[] = [];

  for (const c of compiled) {
    let count = 0;
    const haystack = c.kind === 'KEYWORD' ? normalized!.text : text;
    c.regex.lastIndex = 0;
    for (const match of haystack.matchAll(c.regex)) {
      if (count >= MAX_MATCHES_PER_RULE) break;
      if (match[0].length === 0) continue;
      const from = match.index;
      const to = from + match[0].length;
      const [start, end] = c.kind === 'KEYWORD' ? normalized!.toOriginal(from, to) : [from, to];
      found.push(toDetection(c, text.slice(start, end), start, end));
      count += 1;
    }
  }
  return found;
}
