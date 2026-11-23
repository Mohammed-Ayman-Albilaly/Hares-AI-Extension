import { describe, expect, it } from 'vitest';
import { isMaskable } from '../../src/detectors/maskable';
import { buildEventDraft } from '../../src/logging/event';
import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt } from '../../src/pipeline/analyze';
import type { OrgRule, Policy } from '../../src/policy/types';
import { topicDetections } from '../../src/topics/detect';
import { topicRulesOf } from '../../src/topics/rules';
import { dialogHint } from '../../src/ui/dialog';

const LAYOFFS = '8e7d6c5b-4a39-4281-b7c6-d5e4f3a2b1c0';
const SALARIES = '9f8e7d6c-5b4a-4392-8c7d-e6f5a4b3c2d1';
const KEYWORD = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function topic(id: string, extra: Partial<OrgRule> = {}): OrgRule {
  return {
    id,
    name: id === LAYOFFS ? 'تسريح الموظفين' : 'Salaries',
    kind: 'TOPIC',
    definition: '',
    definitionEn: 'This text discusses plans to lay off employees or cut positions.',
    threshold: 0.3,
    risk: 'MEDIUM',
    action: 'WARN',
    ...extra,
  };
}

const policyOf = (...org: OrgRule[]): Policy => ({ version: 1, departmentId: 'x', rules: { org } });

/** Analyse `text` as if the decision model had returned `scores` for the policy's topics. */
function analyse(text: string, policy: Policy, scores: number[]) {
  const matches = topicDetections(topicRulesOf(policy), scores);
  return analyzePrompt(text, new PlaceholderVault(), { policy, topicDetections: matches });
}

describe('topicDetections', () => {
  const policy = policyOf(topic(LAYOFFS, { threshold: 0.3 }), topic(SALARIES, { threshold: 0.5 }));
  const topics = topicRulesOf(policy);

  it('matches a topic whose score reaches its own threshold', () => {
    expect(topicDetections(topics, [0.3, 0.49]).map((d) => d.rule?.id)).toEqual([LAYOFFS]);
    expect(topicDetections(topics, [0.29, 0.5]).map((d) => d.rule?.id)).toEqual([SALARIES]);
    expect(topicDetections(topics, [0.9, 0.9])).toHaveLength(2);
    expect(topicDetections(topics, [0.1, 0.1])).toEqual([]);
  });

  it('a short prompt scoring 0.34 is caught at the default 0.3 and missed at 0.5', () => {
    expect(topicDetections(topics, [0.34, 0.34]).map((d) => d.rule?.id)).toEqual([LAYOFFS]);
  });

  it('ignores missing or unusable scores', () => {
    expect(topicDetections(topics, [])).toEqual([]);
    expect(topicDetections(topics, [Number.NaN, 0.9]).map((d) => d.rule?.id)).toEqual([SALARIES]);
  });

  it('a match carries the rule but no text of the message, and cannot be masked', () => {
    const [d] = topicDetections(topics, [0.8, 0]);
    expect(d).toMatchObject({ category: 'ORG_RULE', value: '', start: 0, end: 0, wholeMessage: true, source: 'topic', confidence: 0.8 });
    expect(d!.rule).toMatchObject({ id: LAYOFFS, enforce: 'MEDIUM', risk: 'MEDIUM', order: 0 });
    expect(isMaskable(d!)).toBe(false);
  });
});

describe('a TOPIC match in the send check', () => {
  const TEXT = 'We plan to cut 120 positions in January';

  it('WARN: a confirm dialog with Confirm and Edit, and no revised version', () => {
    const a = analyse(TEXT, policyOf(topic(LAYOFFS)), [0.8]);
    expect(a.decision).toMatchObject({ tier: 'MEDIUM', presentation: 'confirm', risk: 'MEDIUM' });
    expect(a.decision.actions).toEqual(['confirm_send', 'edit', 'cancel']);
    expect(a.revised).toBe(TEXT);
    expect(a.findings).toEqual([{ category: 'ORG_RULE', categoryName: 'تسريح الموظفين', tier: 'MEDIUM', placeholder: null, crossesMessages: false }]);
  });

  it('BLOCK: the message cannot be sent, and the only way forward is to edit', () => {
    const a = analyse(TEXT, policyOf(topic(LAYOFFS, { action: 'BLOCK', risk: 'HIGH' })), [0.8]);
    expect(a.decision).toMatchObject({ tier: 'HIGH', presentation: 'block' });
    expect(a.decision.actions).toEqual(['edit', 'cancel']);
  });

  it('BLOCK with an email in the same message: masking the email would still send the topic, so no revised version', () => {
    const a = analyse(`${TEXT}, write to sara@example.com`, policyOf(topic(LAYOFFS, { action: 'BLOCK' })), [0.8]);
    expect(a.decision.tier).toBe('HIGH');
    expect(a.decision.actions).not.toContain('send_masked');
    expect(a.decision.actions).not.toContain('confirm_send');
  });

  it('WARN with an email: the revised version masks the email, and the user decides', () => {
    const a = analyse(`${TEXT}, write to sara@example.com`, policyOf(topic(LAYOFFS)), [0.8]);
    expect(a.decision.tier).toBe('MEDIUM');
    expect(a.decision.actions).toContain('send_masked');
    expect(a.revised).toContain('[EMAIL_1]');
    expect(a.revised).not.toContain('sara@example.com');
    expect(a.findings.map((f) => f.categoryName)).toContain('تسريح الموظفين');
  });

  it('ALLOW: sent with a quiet notice', () => {
    const a = analyse(TEXT, policyOf(topic(LAYOFFS, { action: 'ALLOW', risk: 'LOW' })), [0.8]);
    expect(a.decision).toMatchObject({ tier: 'LOW', presentation: 'notice' });
    expect(a.decision.actions).toContain('send');
  });

  it('below the threshold nothing happens', () => {
    const a = analyse(TEXT, policyOf(topic(LAYOFFS, { threshold: 0.5 })), [0.34]);
    expect(a.detections).toEqual([]);
    expect(a.decision.tier).toBe('SAFE');
  });

  it('two matched topics are listed separately', () => {
    const a = analyse(TEXT, policyOf(topic(LAYOFFS), topic(SALARIES)), [0.8, 0.7]);
    expect(a.findings.map((f) => f.categoryName)).toEqual(['تسريح الموظفين', 'Salaries']);
  });

  it('a card number still blocks with a revised version when the topic only warns', () => {
    const a = analyse(`${TEXT}. Card 4111 1111 1111 1111`, policyOf(topic(LAYOFFS)), [0.8]);
    expect(a.decision.tier).toBe('HIGH');
    expect(a.decision.actions).toContain('send_masked');
  });
});

describe('the log event of a TOPIC match', () => {
  const draft = (policy: Policy, scores: number[], text = 'We plan to cut 120 positions in January') => {
    const a = analyse(text, policy, scores);
    return buildEventDraft({ decision: a.decision, detections: a.detections, platform: 'chatgpt', detector: 'ready', userAction: 'sent_original', now: 0, logId: '3f6c2a1e-8b4d-4c7a-9e2f-1a5b7c9d0e21' })!;
  };

  it('reports the rule id, no category, the rule risk and action, decided by the local model', () => {
    expect(draft(policyOf(topic(LAYOFFS)), [0.8])).toMatchObject({
      categories: [],
      rule_id: LAYOFFS,
      risk_level: 'MEDIUM',
      action: 'WARNED',
      classification_source: 'LOCAL_AI',
    });
  });

  it('carries no score and no text', () => {
    const event = draft(policyOf(topic(LAYOFFS)), [0.8]);
    expect(JSON.stringify(event)).not.toMatch(/0\.8|positions|threshold|confidence|lay off/i);
  });

  it('with several matches, the strictest rule is reported, topic or keyword', () => {
    const keyword: OrgRule = { id: KEYWORD, name: 'Codename', kind: 'KEYWORD', definition: 'falcon', risk: 'LOW', action: 'ALLOW' };
    const policy = policyOf(keyword, topic(LAYOFFS), topic(SALARIES, { action: 'BLOCK', risk: 'HIGH' }));
    const event = draft(policy, [0.8, 0.8], 'falcon: we plan to cut 120 positions');
    expect(event).toMatchObject({ rule_id: SALARIES, action: 'BLOCKED', risk_level: 'HIGH' });
  });

  it('a topic and a category in one message: both are reported', () => {
    const event = draft(policyOf(topic(LAYOFFS)), [0.8], 'cut 120 positions, mail sara@example.com');
    expect(event).toMatchObject({ categories: ['CONTACT_INFO'], rule_id: LAYOFFS });
  });
});

describe('dialog wording', () => {
  it('offers the revised version only when there is one', () => {
    expect(dialogHint(true, true)).toMatch(/revised version/);
    expect(dialogHint(true, false)).toBe('This message cannot be sent as written. Edit it and try again.');
    expect(dialogHint(false, true)).toMatch(/revised version/);
    expect(dialogHint(false, false)).toBe('Send it as written, or edit your message.');
  });
});
