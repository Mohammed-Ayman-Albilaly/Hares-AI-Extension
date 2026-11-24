import { describe, expect, it } from 'vitest';
import { CATEGORY_CODES } from '../../src/contract/categories';
import { bundleToPolicy, parseBundle } from '../../src/policy/bundle';
import { validatePolicy } from '../../src/policy/validate';
import { detectWithOrgRules } from '../../src/rules/org-rules';
import {
  MAX_TOPIC_RULES,
  TOPIC_THRESHOLD_DEFAULT,
  parseTopicFields,
  sameHypotheses,
  topicRulesOf,
} from '../../src/topics/rules';

const EN = 'This text discusses plans to lay off employees, cut positions or restructure departments.';

/** The TOPIC rule exactly as the platform's bundle sends it. */
const TOPIC = {
  id: '8e7d6c5b-4a39-4281-b7c6-d5e4f3a2b1c0',
  name: 'تسريح الموظفين',
  kind: 'TOPIC',
  definition: 'أي حديث عن خطط تسريح موظفين أو إلغاء وظائف',
  definition_en: EN,
  threshold: 0.3,
  risk_level: 'MEDIUM',
  action: 'WARN',
};
const KEYWORD = { id: 'k-1', name: 'Codename', kind: 'KEYWORD', definition: 'falcon', definition_en: null, threshold: null, risk_level: 'LOW', action: 'ALLOW' };

function bundle(rules: unknown[], extra: Record<string, unknown> = {}) {
  return {
    version: 9,
    policy: CATEGORY_CODES.map((code) => ({ category_code: code, action: 'WARN', enabled: true })),
    rules,
    ...extra,
  };
}

describe('parseTopicFields', () => {
  it('keeps a valid description (trimmed) and threshold', () => {
    expect(parseTopicFields(`  ${EN}  `, 0.4)).toEqual({ definitionEn: EN, threshold: 0.4 });
  });

  it('treats a missing and a null description the same: the rule cannot be enforced', () => {
    expect(parseTopicFields(undefined, 0.3)).toBeNull();
    expect(parseTopicFields(null, 0.3)).toBeNull();
    expect(parseTopicFields(42, 0.3)).toBeNull();
  });

  it('refuses a description outside 20 to 300 characters', () => {
    expect(parseTopicFields('Too short.', 0.3)).toBeNull();
    expect(parseTopicFields('x'.repeat(301), 0.3)).toBeNull();
    expect(parseTopicFields('x'.repeat(20), 0.3)).not.toBeNull();
    expect(parseTopicFields('x'.repeat(300), 0.3)).not.toBeNull();
  });

  it('uses 0.3 when the threshold is missing, null or not a number', () => {
    for (const t of [undefined, null, 'high', Number.NaN]) {
      expect(parseTopicFields(EN, t)?.threshold).toBe(TOPIC_THRESHOLD_DEFAULT);
    }
  });

  it('moves a threshold outside 0.2 to 0.9 to the nearest limit', () => {
    expect(parseTopicFields(EN, 0.05)?.threshold).toBe(0.2);
    expect(parseTopicFields(EN, 1)?.threshold).toBe(0.9);
    expect(parseTopicFields(EN, 0.5)?.threshold).toBe(0.5);
  });
});

describe('TOPIC rules in the policy bundle', () => {
  it('reads the rule as the platform sends it', () => {
    const parsed = parseBundle(bundle([TOPIC]));
    expect(parsed?.rules).toEqual([
      { id: TOPIC.id, name: TOPIC.name, kind: 'TOPIC', definition: TOPIC.definition, definitionEn: EN, threshold: 0.3, risk: 'MEDIUM', action: 'WARN' },
    ]);
  });

  it('skips a TOPIC rule saved before the English description existed, and keeps the others', () => {
    const old = { ...TOPIC, id: 'old', definition_en: null, threshold: 0.3 };
    const older = { id: 'older', name: 'x', kind: 'TOPIC', definition: 'confidential acquisition plans', risk_level: 'MEDIUM', action: 'WARN' };
    const parsed = parseBundle(bundle([old, older, KEYWORD, TOPIC]));
    expect(parsed?.rules.map((r) => r.id)).toEqual(['k-1', TOPIC.id]);
  });

  it('accepts null in the new fields of KEYWORD and PATTERN rules', () => {
    const parsed = parseBundle(bundle([KEYWORD]));
    expect(parsed?.rules).toEqual([{ id: 'k-1', name: 'Codename', kind: 'KEYWORD', definition: 'falcon', risk: 'LOW', action: 'ALLOW' }]);
  });

  it('ignores fields it does not know, on the bundle and on a rule', () => {
    const parsed = parseBundle(bundle([{ ...TOPIC, created_by: 'someone', future_field: { a: 1 } }], { format: 3, generated_at: '2026-11-24T00:00:00Z' }));
    expect(parsed?.version).toBe(9);
    expect(parsed?.rules).toHaveLength(1);
    expect(parsed?.rules[0]).not.toHaveProperty('future_field');
  });

  it('survives storage: the stored policy validates with its TOPIC rule intact', () => {
    const policy = bundleToPolicy(parseBundle(bundle([KEYWORD, TOPIC]))!);
    const { policy: stored, warnings } = validatePolicy(JSON.parse(JSON.stringify(policy)));
    expect(warnings).toEqual([]);
    expect(stored?.rules?.org?.[1]).toMatchObject({ kind: 'TOPIC', definitionEn: EN, threshold: 0.3 });
  });

  it('drops a stored TOPIC rule whose description was tampered with', () => {
    const policy = bundleToPolicy(parseBundle(bundle([TOPIC]))!);
    const raw = JSON.parse(JSON.stringify(policy)) as { rules: { org: Array<Record<string, unknown>> } };
    raw.rules.org[0]!.definitionEn = 'short';
    const { policy: stored, warnings } = validatePolicy(raw);
    expect(stored?.rules?.org).toEqual([]);
    expect(warnings).toContain('rules.org: malformed entry ignored');
  });
});

describe('topicRulesOf', () => {
  it('lists the TOPIC rules with their position among all rules', () => {
    const policy = bundleToPolicy(parseBundle(bundle([KEYWORD, TOPIC]))!);
    expect(topicRulesOf(policy)).toEqual([
      { rule: policy.rules!.org![1], order: 1, hypothesis: EN, threshold: 0.3 },
    ]);
  });

  it('is empty for a policy without rules', () => {
    expect(topicRulesOf({ version: 1, departmentId: 'x' })).toEqual([]);
  });

  it('scores at most 10 topics, the first in bundle order', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ ...TOPIC, id: `t-${i}` }));
    const topics = topicRulesOf(bundleToPolicy(parseBundle(bundle(many))!));
    expect(topics).toHaveLength(MAX_TOPIC_RULES);
    expect(topics.map((t) => t.rule.id)).toEqual(many.slice(0, 10).map((r) => r.id));
  });
});

describe('TOPIC rules and the pattern matcher', () => {
  it('a TOPIC rule never matches as a keyword or a pattern, even when its words are in the text', () => {
    const policy = bundleToPolicy(parseBundle(bundle([{ ...TOPIC, definition: 'falcon' }, KEYWORD]))!);
    const found = detectWithOrgRules('project falcon', policy);
    expect(found.map((d) => d.rule?.id)).toEqual(['k-1']);
  });
});

describe('sameHypotheses', () => {
  const rulesOf = (...rules: unknown[]) => topicRulesOf(bundleToPolicy(parseBundle(bundle(rules))!));
  const other = { ...TOPIC, id: 'other', definition_en: 'This text discusses employee salaries, pay raises or bonuses.' };

  it('scores can be reused when only the threshold, action or name of a rule changed', () => {
    expect(sameHypotheses(rulesOf(TOPIC, other), rulesOf({ ...TOPIC, threshold: 0.5, action: 'ALLOW', name: 'x' }, other))).toBe(true);
  });

  it('a changed description, order or number of rules means asking the model again', () => {
    expect(sameHypotheses(rulesOf(TOPIC, other), rulesOf(other, TOPIC))).toBe(false);
    expect(sameHypotheses(rulesOf(TOPIC), rulesOf(TOPIC, other))).toBe(false);
    expect(sameHypotheses(rulesOf(TOPIC), rulesOf({ ...TOPIC, definition_en: 'This text discusses layoffs, job cuts or restructuring.' }))).toBe(false);
    expect(sameHypotheses([], [])).toBe(true);
  });
});
