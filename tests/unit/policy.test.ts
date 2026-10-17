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
    customKeywords: [
      { text: 'Project Falcon', category: 'CORPORATE', label: 'CODENAME' },
      { text: 'مشروع الصقر', category: 'CORPORATE', label: 'CODENAME' },
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

  it('custom keywords are detected and masked, English and Arabic', () => {
    const en = run('Summarize the Project Falcon roadmap', DEV_POLICY);
    expect(en.revised).toBe('Summarize the [CODENAME_1] roadmap');
    expect(en.decision.tier).toBe('MEDIUM');
    expect(run('لخص لي خطة مشروع الصقر', DEV_POLICY).revised).toBe('لخص لي خطة [CODENAME_1]');
  });

  it('custom keywords are literal text with word boundaries, never regex', () => {
    const policy: Policy = {
      version: 1,
      departmentId: 'x',
      rules: { customKeywords: [{ text: 'a.b', category: 'CORPORATE', label: 'CODENAME' }] },
    };
    expect(run('use axb here', policy).findings).toEqual([]);
    expect(run('use a.b here', policy).revised).toBe('use [CODENAME_1] here');
    expect(run('Project Falconry club', DEV_POLICY).findings).toEqual([]);
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
        customKeywords: [
          { text: 'Falcon', category: 'CORPORATE', label: 'CODENAME' },
          { text: 'x', category: 'CORPORATE', label: 'CODENAME' }, // too short
          { text: 'Ok', category: 'NOPE', label: 'CODENAME' }, // bad category
          { text: 'Ok', category: 'CORPORATE', label: 'lower' }, // bad label
        ],
      },
      decision: { uncertaintyThreshold: 5, hypotheses: { high: 'Contains secrets.' } },
    });
    expect(policy?.categories).toEqual({ CONTACT: { tier: 'HIGH' }, FINANCIAL: {} });
    expect(policy?.labels).toEqual({ API_KEY: { tier: 'LOW', userOverridable: true } });
    expect(policy?.rules?.customKeywords).toHaveLength(1);
    expect(policy?.decision).toEqual({ hypotheses: { high: 'Contains secrets.' } });
    expect(warnings.length).toBeGreaterThan(0);
  });
});
