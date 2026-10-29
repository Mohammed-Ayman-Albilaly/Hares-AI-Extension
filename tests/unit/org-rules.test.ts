import { describe, expect, it } from 'vitest';
import { detectWithRules } from '../../src/detectors/rules';
import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt } from '../../src/pipeline/analyze';
import type { OrgRule, Policy } from '../../src/policy/types';
import { normalizeWithMap } from '../../src/rules/text';

function policyWith(...org: OrgRule[]): Policy {
  return { version: 1, departmentId: 'x', rules: { org } };
}

function keyword(definition: string, extra: Partial<OrgRule> = {}): OrgRule {
  return { id: 'k1', name: 'Keywords', kind: 'KEYWORD', definition, risk: 'MEDIUM', action: 'WARN', ...extra };
}

function pattern(definition: string, extra: Partial<OrgRule> = {}): OrgRule {
  return { id: 'p1', name: 'Pattern', kind: 'PATTERN', definition, risk: 'HIGH', action: 'BLOCK', ...extra };
}

/** The matched values of the organisation rules only. */
function matches(text: string, ...org: OrgRule[]): string[] {
  return detectWithRules(text, policyWith(...org))
    .filter((d) => d.rule)
    .map((d) => d.value);
}

describe('KEYWORD rules', () => {
  it('match whole words only', () => {
    expect(matches('the falcon flew', keyword('falcon'))).toEqual(['falcon']);
    expect(matches('falconry and falcons', keyword('falcon'))).toEqual([]);
    expect(matches('a_falcon', keyword('falcon'))).toEqual([]);
    expect(matches('(falcon)', keyword('falcon'))).toEqual(['falcon']);
  });

  it('are case-insensitive for Latin letters', () => {
    expect(matches('Project FALCON and project falcon', keyword('Project Falcon'))).toEqual([
      'Project FALCON',
      'project falcon',
    ]);
  });

  it('take one word or phrase per line', () => {
    expect(matches('alpha and bravo', keyword('alpha\nbravo\r\ncharlie'))).toEqual(['alpha', 'bravo']);
  });

  it('match a phrase as consecutive words with any whitespace or punctuation between them', () => {
    const rule = keyword('Project Falcon');
    expect(matches('Project   Falcon', rule)).toEqual(['Project   Falcon']);
    expect(matches('Project\nFalcon', rule)).toEqual(['Project\nFalcon']);
    expect(matches('Project-Falcon', rule)).toEqual(['Project-Falcon']);
    expect(matches('Project, Falcon', rule)).toEqual(['Project, Falcon']);
    expect(matches('Project the Falcon', rule)).toEqual([]);
    expect(matches('Falcon Project', rule)).toEqual([]);
  });

  it('fold Arabic letter variants', () => {
    // alef forms → ا, ة → ه, ى → ي
    expect(matches('أحمد', keyword('احمد'))).toEqual(['أحمد']);
    expect(matches('احمد', keyword('إحمد'))).toEqual(['احمد']);
    expect(matches('مدرسة', keyword('مدرسه'))).toEqual(['مدرسة']);
    expect(matches('مستشفى', keyword('مستشفي'))).toEqual(['مستشفى']);
    expect(matches('مستشفي', keyword('مستشفى'))).toEqual(['مستشفي']);
  });

  it('ignore Arabic diacritics and tatweel, and keep offsets in the original text', () => {
    const text = 'لخص مَشْرُوع الصَّقر الان';
    const found = detectWithRules(text, policyWith(keyword('مشروع الصقر'))).filter((d) => d.rule);
    expect(found).toHaveLength(1);
    expect(text.slice(found[0]!.start, found[0]!.end)).toBe('مَشْرُوع الصَّقر');
    expect(matches('مشـــروع', keyword('مشروع'))).toEqual(['مشـــروع']);
  });

  it('do not treat regex characters as regex', () => {
    expect(matches('use axb here', keyword('a.b'))).toEqual([]);
    expect(matches('use a.b here', keyword('a.b'))).toEqual(['a.b']);
    expect(matches('price (usd)', keyword('(usd)'))).toEqual(['usd']);
  });

  it('a definition with no words matches nothing', () => {
    expect(matches('anything', keyword('\n  \n...'))).toEqual([]);
  });

  it('normalising maps ranges back to the original text', () => {
    const n = normalizeWithMap('Abًc');
    expect(n.text).toBe('abc');
    expect(n.toOriginal(1, 3)).toEqual([1, 4]);
  });
});

describe('PATTERN rules', () => {
  it('are compiled with the flag i only', () => {
    expect(matches('Ticket ABC-123 and abc-456', pattern(String.raw`abc-\d+`))).toEqual(['ABC-123', 'abc-456']);
  });

  it('a definition that does not compile is skipped, the other rules still run', () => {
    const bad = pattern('(unclosed', { id: 'bad' });
    const good = keyword('falcon', { id: 'good' });
    expect(matches('falcon (unclosed', bad, good)).toEqual(['falcon']);
  });

  it('a very long definition is skipped', () => {
    expect(matches('aaa', pattern('a'.repeat(513)))).toEqual([]);
  });

  it('an empty match is ignored', () => {
    expect(matches('abc', pattern('x*'))).toEqual([]);
  });
});

describe('rule detections in the analysis', () => {
  it('carry the rule id, name and the level of the rule action', () => {
    const rules = policyWith(keyword('Project Falcon', { id: 'rule-1', name: 'Codename', action: 'BLOCK', risk: 'LOW' }));
    const [d] = detectWithRules('Project Falcon', rules);
    expect(d?.rule).toEqual({ id: 'rule-1', name: 'Codename', risk: 'LOW', enforce: 'HIGH', order: 0 });
  });

  it('the action of the rule decides what the user sees', () => {
    const run = (action: OrgRule['action']) =>
      analyzePrompt('see Project Falcon', new PlaceholderVault(), {
        policy: policyWith(keyword('Project Falcon', { action })),
      }).decision.tier;
    expect(run('BLOCK')).toBe('HIGH');
    expect(run('WARN')).toBe('MEDIUM');
    expect(run('ALLOW')).toBe('LOW');
  });

  it('a rule with risk NONE still applies its action', () => {
    const a = analyzePrompt('see Project Falcon', new PlaceholderVault(), {
      policy: policyWith(keyword('Project Falcon', { risk: 'NONE', action: 'WARN' })),
    });
    expect(a.decision.tier).toBe('MEDIUM');
  });

  it('the finding shows the rule name and the text is masked', () => {
    const a = analyzePrompt('see Project Falcon', new PlaceholderVault(), {
      policy: policyWith(keyword('Project Falcon', { name: 'Codename' })),
    });
    expect(a.revised).toBe('see [RULE_1]');
    expect(a.findings.map((f) => f.categoryName)).toEqual(['Codename']);
  });

  it('a built-in detection and a rule match on the same text: the stricter wins', () => {
    const a = analyzePrompt('mail sara@example.com', new PlaceholderVault(), {
      policy: policyWith(pattern(String.raw`[a-z]+@example\.com`, { action: 'BLOCK' })),
    });
    expect(a.detections).toHaveLength(1);
    expect(a.detections[0]?.rule?.id).toBe('p1');
    expect(a.decision.tier).toBe('HIGH');
  });

  it('are found across two messages like any other value', () => {
    const a = analyzePrompt('Falcon', new PlaceholderVault(), {
      policy: policyWith(keyword('Project Falcon')),
      historyTail: 'tell me about Project',
    });
    expect(a.decision.tier).toBe('MEDIUM');
  });
});
