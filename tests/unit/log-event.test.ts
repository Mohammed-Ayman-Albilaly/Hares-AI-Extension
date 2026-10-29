import { describe, expect, it } from 'vitest';
import { CATEGORY_CODES } from '../../src/contract/categories';
import { detectWithRules } from '../../src/detectors/rules';
import {
  buildEventDraft,
  classificationSourceFor,
  isEventDraft,
  pickRuleId,
  toLogEvent,
  userDecisionFor,
  type EventDraft,
  type UserAction,
} from '../../src/logging/event';
import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt } from '../../src/pipeline/analyze';
import type { OrgRule, Policy } from '../../src/policy/types';

const LOG_ID = '3f6c2a1e-8b4d-4c7a-9e2f-1a5b7c9d0e21';
const RULE_A = '8e7d6c5b-4a39-4281-b7c6-d5e4f3a2b1c0';
const RULE_B = '9f8e7d6c-5b4a-4392-8c7d-e6f5a4b3c2d1';
const NOW = Date.parse('2026-10-26T09:14:03.512Z');

function eventFor(text: string, options: { policy?: Policy; action?: UserAction; detector?: Parameters<typeof classificationSourceFor>[0]; platform?: string } = {}) {
  const analysis = analyzePrompt(text, new PlaceholderVault(), { policy: options.policy });
  return buildEventDraft({
    decision: analysis.decision,
    detections: analysis.detections,
    platform: options.platform ?? 'chatgpt',
    detector: options.detector ?? 'ready',
    userAction: options.action ?? 'auto_sent',
    now: NOW,
    logId: LOG_ID,
  })!;
}

function rule(id: string, extra: Partial<OrgRule> = {}): OrgRule {
  return { id, name: id, kind: 'KEYWORD', definition: 'falcon', risk: 'MEDIUM', action: 'WARN', ...extra };
}

describe('event content', () => {
  it('a clean message is still an event: NONE / ALLOWED / no categories', () => {
    expect(eventFor('What is the capital of France?')).toEqual({
      log_id: LOG_ID,
      occurred_at: NOW,
      platform: 'CHATGPT',
      risk_level: 'NONE',
      action: 'ALLOWED',
      categories: [],
      classification_source: 'LOCAL_AI',
      user_decision: 'NONE',
      rule_id: null,
      schema_version: 1,
    });
  });

  it('a blocked message: highest risk, strictest action, distinct contract codes', () => {
    const e = eventFor('my gmail password is Hunter2! and my card is 4111 1111 1111 1111', { action: 'sent_revised' });
    expect(e).toMatchObject({ risk_level: 'HIGH', action: 'BLOCKED', user_decision: 'REVISION_USED' });
    // The word "password" is itself reported (KEYWORD_PATTERNS), next to the value after it.
    expect([...e.categories].sort()).toEqual(['AUTH_SECRETS', 'FINANCIAL_BANKING', 'KEYWORD_PATTERNS']);
  });

  it('a warned message', () => {
    const e = eventFor('Please reply to sara@example.com', { action: 'sent_original', platform: 'claude' });
    expect(e).toMatchObject({ risk_level: 'MEDIUM', action: 'WARNED', categories: ['CONTACT_INFO'], user_decision: 'SUBMITTED_ANYWAY', platform: 'CLAUDE' });
  });

  it('a sensitive word without a value is LOW and allowed', () => {
    const e = eventFor('I need a password reset link for my account');
    expect(e).toMatchObject({ risk_level: 'LOW', action: 'ALLOWED', categories: ['KEYWORD_PATTERNS'] });
  });

  it('never repeats a category', () => {
    const e = eventFor('mail a@example.com and b@example.com and 0551234567');
    expect(e.categories).toEqual(['CONTACT_INFO']);
  });

  it('contains no prompt text, and only contract fields', () => {
    const text = 'secret project falcon mail sara@example.com password is Hunter2!';
    const event = toLogEvent(eventFor(text), 0);
    expect(JSON.stringify(event)).not.toMatch(/falcon|sara|Hunter2|password is/i);
    expect(Object.keys(event).sort()).toEqual(
      ['action', 'categories', 'classification_source', 'event_time', 'log_id', 'platform', 'risk_level', 'rule_id', 'schema_version', 'user_decision'].sort(),
    );
    expect(event).not.toHaveProperty('user_id');
    expect(event).not.toHaveProperty('department_id');
    expect(event).not.toHaveProperty('occurred_at');
  });

  it('only reports codes from the 24', () => {
    const e = eventFor('Write to Sarah Mitchell at sara@example.com, ip 10.0.0.1, C:\\Users\\ali\\a.xlsx, DB_PASSWORD=Sup3rSecret99');
    for (const code of e.categories) expect(CATEGORY_CODES).toContain(code);
  });

  it('does not know an unsupported platform', () => {
    expect(
      buildEventDraft({ decision: { risk: 'SAFE', policyTier: 'SAFE' }, detections: [], platform: 'copilot', detector: 'ready', userAction: 'auto_sent', now: NOW, logId: LOG_ID }),
    ).toBeNull();
  });
});

describe('rule matches', () => {
  const policy = (...org: OrgRule[]): Policy => ({ version: 1, departmentId: 'x', rules: { org } });

  it('a rule-only match: no categories, the rule id, and the rule risk and action', () => {
    const e = eventFor('see falcon status', { policy: policy(rule(RULE_A, { risk: 'HIGH', action: 'BLOCK' })) });
    expect(e).toMatchObject({ categories: [], rule_id: RULE_A, risk_level: 'HIGH', action: 'BLOCKED' });
  });

  it('a rule with risk NONE is logged as is, with the rule action', () => {
    const e = eventFor('see falcon status', { policy: policy(rule(RULE_A, { risk: 'NONE', action: 'WARN' })) });
    expect(e).toMatchObject({ rule_id: RULE_A, risk_level: 'NONE', action: 'WARNED' });
  });

  it('a rule and a category in one message: both are reported', () => {
    const e = eventFor('falcon: mail sara@example.com', { policy: policy(rule(RULE_A)) });
    expect(e).toMatchObject({ categories: ['CONTACT_INFO'], rule_id: RULE_A });
  });

  it('with several rules, the strictest action wins, then the highest risk, then bundle order', () => {
    const detect = (...rules: OrgRule[]) => pickRuleId(detectWithRules('falcon', policy(...rules)).concat());
    // Same text matched by all of them: only one survives overlap resolution, so test the picker directly.
    const d = (r: OrgRule, order: number) => ({
      category: 'ORG_RULE' as const, label: 'RULE', value: 'x', start: 0, end: 1, source: 'rule' as const, confidence: 1,
      rule: { id: r.id, name: r.name, risk: r.risk === 'NONE' ? ('SAFE' as const) : r.risk, enforce: r.action === 'BLOCK' ? ('HIGH' as const) : r.action === 'WARN' ? ('MEDIUM' as const) : ('LOW' as const), order },
    });
    expect(pickRuleId([d(rule(RULE_A, { action: 'WARN', risk: 'HIGH' }), 0), d(rule(RULE_B, { action: 'BLOCK', risk: 'LOW' }), 1)])).toBe(RULE_B);
    expect(pickRuleId([d(rule(RULE_A, { risk: 'LOW' }), 0), d(rule(RULE_B, { risk: 'HIGH' }), 1)])).toBe(RULE_B);
    expect(pickRuleId([d(rule(RULE_B), 1), d(rule(RULE_A), 0)])).toBe(RULE_A);
    expect(pickRuleId([])).toBeNull();
    expect(detect()).toBeNull();
  });

  it('a rule id that is not a UUID is sent as no rule instead of losing the event', () => {
    const e = eventFor('see falcon', { policy: policy(rule('not-a-uuid')) });
    expect(e.rule_id).toBeNull();
    expect(isEventDraft(e)).toBe(true);
  });
});

describe('user_decision', () => {
  it.each([
    ['auto_sent', 'NONE'],
    ['sent_original', 'SUBMITTED_ANYWAY'],
    ['sent_revised', 'REVISION_USED'],
    ['copied_revised', 'REVISION_USED'],
    ['edited', 'EDITED'],
    ['cancelled', 'CANCELLED'],
  ] as const)('%s → %s', (action, decision) => {
    expect(userDecisionFor(action)).toBe(decision);
  });

  it('a blocked message can never be SUBMITTED_ANYWAY: the block dialog has no Confirm button', () => {
    const e = eventFor('my password is Hunter2!', { action: 'sent_revised' });
    expect(e.action).toBe('BLOCKED');
    expect(e.user_decision).not.toBe('SUBMITTED_ANYWAY');
  });
});

describe('classification_source', () => {
  it.each([
    ['ready', 'LOCAL_AI'],
    ['disabled', 'LOCAL'],
    ['loading', 'LOCAL_ONLY_FALLBACK'],
    ['timeout', 'LOCAL_ONLY_FALLBACK'],
    ['error', 'LOCAL_ONLY_FALLBACK'],
    ['idle', 'LOCAL_ONLY_FALLBACK'],
  ] as const)('%s → %s', (outcome, source) => {
    expect(classificationSourceFor(outcome)).toBe(source);
  });
});

describe('event_time and validation', () => {
  it('is UTC with Z, corrected by the server offset', () => {
    const draft = eventFor('hello');
    expect(toLogEvent(draft, 0).event_time).toBe('2026-10-26T09:14:03.512Z');
    expect(toLogEvent(draft, 3_600_000).event_time).toBe('2026-10-26T10:14:03.512Z');
    expect(toLogEvent(draft, -90_000).event_time).toMatch(/Z$/);
  });

  it('isEventDraft accepts what the builder makes and rejects anything else', () => {
    const draft = eventFor('hello');
    expect(isEventDraft(draft)).toBe(true);
    const bad: unknown[] = [
      null,
      { ...draft, log_id: 'nope' },
      { ...draft, occurred_at: 'now' },
      { ...draft, platform: 'COPILOT' },
      { ...draft, risk_level: 'EXTREME' },
      { ...draft, action: 'DENIED' },
      { ...draft, categories: ['NAMES'] },
      { ...draft, categories: ['LOCATION', 'LOCATION'] },
      { ...draft, classification_source: 'CLOUD' },
      { ...draft, user_decision: 'MAYBE' },
      { ...draft, rule_id: 'x' },
      { ...draft, schema_version: 2 },
    ];
    for (const b of bad) expect(isEventDraft(b), JSON.stringify(b)).toBe(false);
    const withoutDraftFields: EventDraft = { ...draft };
    expect(isEventDraft(withoutDraftFields)).toBe(true);
  });
});
