import { describe, expect, it } from 'vitest';
import { detectWithRules } from '../../src/detectors/rules';
import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt } from '../../src/pipeline/analyze';
import { activeExceptions } from '../../src/policy/defaults';
import type { Policy, UserExceptions } from '../../src/policy/types';
import { validatePolicy } from '../../src/policy/validate';

const API_KEY_PROMPT = 'why does sk-proj-abcdEFGH1234ijklMNOP5678 return 401?';
const PASSWORD_PROMPT = 'my password is Hunter2!';

function run(text: string, policy?: Policy, exceptions?: UserExceptions | null) {
  return analyzePrompt(text, new PlaceholderVault(), { policy, exceptions });
}

/** Developers department: API keys are MEDIUM and users may exempt them; passwords stay HIGH. */
const DEV_POLICY: Policy = {
  version: 3,
  departmentId: 'engineering',
  labels: { API_KEY: { tier: 'MEDIUM', userOverridable: true } },
  rules: {
    disabledPatterns: ['url'],
    org: [
      { id: 'r-falcon', name: 'Codenames', kind: 'KEYWORD', definition: 'Project Falcon\nمشروع الصقر', risk: 'MEDIUM', action: 'WARN' },
    ],
  },
};

describe('department policy', () => {
  it('without a policy, behaves exactly like the built-in table', () => {
    expect(run(API_KEY_PROMPT).decision.tier).toBe('HIGH');
  });

  it('a label override changes one type without touching the rest of its category', () => {
    expect(run(API_KEY_PROMPT, DEV_POLICY).decision.tier).toBe('MEDIUM');
    expect(run(PASSWORD_PROMPT, DEV_POLICY).decision.tier).toBe('HIGH'); // same category, untouched
  });

  it('a category override applies to every type in it', () => {
    const policy: Policy = { version: 1, departmentId: 'x', categories: { CONTACT: { tier: 'HIGH' } } };
    expect(run('mail sara@example.com', policy).decision.tier).toBe('HIGH');
  });

  it('tier SAFE switches a type off entirely: not shown, not masked', () => {
    const policy: Policy = { version: 1, departmentId: 'x', labels: { EMAIL: { tier: 'SAFE' } } };
    const a = run('mail sara@example.com', policy);
    expect(a.decision.tier).toBe('SAFE');
    expect(a.revised).toBe('mail sara@example.com');
    expect(a.findings).toEqual([]);
  });

  it('disabled built-in patterns no longer match', () => {
    expect(detectWithRules('read https://example.com/docs').map((d) => d.label)).toContain('URL');
    expect(detectWithRules('read https://example.com/docs', DEV_POLICY)).toEqual([]);
  });

  it('organisation keyword rules are detected and masked, English and Arabic', () => {
    const en = run('Summarize the Project Falcon roadmap', DEV_POLICY);
    expect(en.revised).toBe('Summarize the [RULE_1] roadmap');
    expect(en.decision.tier).toBe('MEDIUM');
    expect(run('لخص لي خطة مشروع الصقر', DEV_POLICY).revised).toBe('لخص لي خطة [RULE_1]');
  });

  it('keyword rules are whole words, never regex', () => {
    expect(run('Project Falconry club', DEV_POLICY).findings).toEqual([]);
    const policy: Policy = {
      version: 1,
      departmentId: 'x',
      rules: { org: [{ id: 'r1', name: 'dots', kind: 'KEYWORD', definition: 'a.b', risk: 'LOW', action: 'ALLOW' }] },
    };
    expect(run('use axb here', policy).findings).toEqual([]);
  });
});

describe('user exceptions', () => {
  it('an allowed exception is enforced as LOW but logged at the policy tier', () => {
    const a = run(API_KEY_PROMPT, DEV_POLICY, { categories: [], labels: ['API_KEY'] });
    expect(a.decision.tier).toBe('LOW'); // enforced on the device: sent, quiet toast
    expect(a.decision.policyTier).toBe('MEDIUM'); // what the log records
    expect(a.decision.exceptedLabels).toEqual(['API_KEY']);
    expect(a.decision.actions).toContain('send');
  });

  it('is ignored when the policy does not allow it', () => {
    // Built-in policy: nothing is overridable.
    const a = run(API_KEY_PROMPT, undefined, { categories: ['AUTH_SECRET'], labels: ['API_KEY'] });
    expect(a.decision.tier).toBe('HIGH');
    expect(a.decision.exceptedLabels).toEqual([]);
  });

  it('exempting API_KEY does not exempt passwords in the same category', () => {
    const a = run(PASSWORD_PROMPT, DEV_POLICY, { categories: [], labels: ['API_KEY'] });
    expect(a.decision.tier).toBe('HIGH');
  });

  it('does not lower other data in the same message', () => {
    const a = run(`${API_KEY_PROMPT} card 4111 1111 1111 1111`, DEV_POLICY, { categories: [], labels: ['API_KEY'] });
    expect(a.decision.tier).toBe('HIGH');
    expect(a.decision.policyTier).toBe('HIGH');
  });

  it('stops applying after it expires', () => {
    expect(activeExceptions({ categories: [], labels: ['API_KEY'], until: '2020-01-01T00:00:00Z' }).labels.size).toBe(0);
    const a = run(API_KEY_PROMPT, DEV_POLICY, { categories: [], labels: ['API_KEY'], until: '2020-01-01T00:00:00Z' });
    expect(a.decision.tier).toBe('MEDIUM');
  });
});

describe('validatePolicy', () => {
  it('rejects input without a valid version or department', () => {
    expect(validatePolicy(null).policy).toBeNull();
    expect(validatePolicy({ departmentId: 'x' }).policy).toBeNull();
    expect(validatePolicy({ version: -1, departmentId: 'x' }).policy).toBeNull();
    expect(validatePolicy({ version: 1, departmentId: '' }).policy).toBeNull();
  });

  it('drops malformed fields and keeps the rest', () => {
    const { policy, warnings } = validatePolicy({
      version: 2,
      departmentId: 'finance',
      categories: { CONTACT: { tier: 'HIGH' }, NOT_A_CATEGORY: { tier: 'LOW' }, FINANCIAL: { tier: 'EXTREME' } },
      labels: { API_KEY: { tier: 'LOW', userOverridable: true }, 'bad label': { tier: 'LOW' } },
      rules: {
        org: [
          { id: 'r1', name: 'Falcon', kind: 'KEYWORD', definition: 'Falcon', risk: 'HIGH', action: 'BLOCK' },
          { id: 'r2', name: 'Topic', kind: 'TOPIC', definition: 'layoffs', risk: 'HIGH', action: 'BLOCK' }, // not enforced
          { id: 'r3', name: 'Bad action', kind: 'KEYWORD', definition: 'x', risk: 'HIGH', action: 'DENY' },
          { id: 'r4', name: 'Bad risk', kind: 'KEYWORD', definition: 'x', risk: 'EXTREME', action: 'WARN' },
          { id: 'r5', name: 'Empty', kind: 'PATTERN', definition: '', risk: 'LOW', action: 'ALLOW' },
        ],
      },
      decision: { uncertaintyThreshold: 5, hypotheses: { high: 'Contains secrets.' } },
    });
    expect(policy?.categories).toEqual({ CONTACT: { tier: 'HIGH' }, FINANCIAL: {} });
    expect(policy?.labels).toEqual({ API_KEY: { tier: 'LOW', userOverridable: true } });
    expect(policy?.rules?.org?.map((r) => r.id)).toEqual(['r1']);
    expect(policy?.decision).toEqual({ hypotheses: { high: 'Contains secrets.' } });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('disabled category', () => {
  it('a switched-off type does not hide an enforced one it overlaps', () => {
    // The ID-number rule and the phone rule both match the digits; with ID
    // numbers off, the phone detection must still be found.
    const text = 'call 0551234567';
    const off: Policy = { version: 1, departmentId: 'x', categories: { PERSONAL_IDENTITY: { tier: 'SAFE' } } };
    expect(detectWithRules(text, off).map((d) => d.label)).toContain('PHONE');
  });

  it('a name from the model is MEDIUM by default even though its category is HIGH', () => {
    const a = analyzePrompt('Write to Sarah Mitchell', new PlaceholderVault(), {
      modelDetections: [
        { category: 'PERSONAL_IDENTITY', label: 'PERSON', value: 'Sarah Mitchell', start: 9, end: 23, source: 'ner', confidence: 0.9 },
      ],
    });
    expect(a.decision.tier).toBe('MEDIUM');
  });

  it('switching a category off ignores the model labels mapped to it too', () => {
    const policy: Policy = { version: 1, departmentId: 'x', categories: { PERSONAL_IDENTITY: { tier: 'SAFE' } } };
    const a = analyzePrompt('Write to Sarah Mitchell', new PlaceholderVault(), {
      policy,
      modelDetections: [
        { category: 'PERSONAL_IDENTITY', label: 'PERSON', value: 'Sarah Mitchell', start: 9, end: 23, source: 'ner', confidence: 0.9 },
      ],
    });
    expect(a.detections).toEqual([]);
    expect(a.decision.tier).toBe('SAFE');
  });

  it('a switched-off model detection does not mask over an enforced rule detection', () => {
    const text = 'mail sara@example.com';
    const policy: Policy = { version: 1, departmentId: 'x', categories: { PERSONAL_IDENTITY: { tier: 'SAFE' } } };
    const a = analyzePrompt(text, new PlaceholderVault(), {
      policy,
      modelDetections: [
        { category: 'PERSONAL_IDENTITY', label: 'PERSON', value: 'sara@example.com', start: 5, end: 21, source: 'ner', confidence: 0.99 },
      ],
    });
    expect(a.revised).toBe('mail [EMAIL_1]');
  });
});
