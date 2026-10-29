import { describe, expect, it } from 'vitest';
import { createPolicySync } from '../../src/backend/policy-sync';
import { Session } from '../../src/backend/session';
import { loginErrorMessage, signedOutMessage } from '../../src/backend/messages';
import { CATEGORY_CODES } from '../../src/contract/categories';
import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt } from '../../src/pipeline/analyze';
import { bundleToPolicy, parseBundle } from '../../src/policy/bundle';
import type { Policy } from '../../src/policy/types';
import { validatePolicy } from '../../src/policy/validate';
import { MemoryArea, TOKENS, apiError, scriptedFetch, type RecordedRequest, type ScriptedResponse } from '../helpers/backend';

type Entry = { category_code: string; action: string; enabled: boolean; risk_level?: string };

function entries(overrides: Record<string, Partial<Entry>> = {}): Entry[] {
  return CATEGORY_CODES.map((code) => ({ category_code: code, action: 'WARN', enabled: true, ...overrides[code] }));
}

function bundle(overrides: Record<string, Partial<Entry>> = {}, rules: unknown[] = [], version = 7) {
  return { version, policy: entries(overrides), rules };
}

const RULE = { id: 'r-1', name: 'Codename', kind: 'KEYWORD', definition: 'Project Falcon', risk_level: 'MEDIUM', action: 'WARN' };

describe('parseBundle', () => {
  it('accepts exactly one valid entry per category', () => {
    const parsed = parseBundle(bundle({}, [RULE]));
    expect(parsed?.version).toBe(7);
    expect(parsed?.policy).toHaveLength(24);
    expect(parsed?.rules).toEqual([{ id: 'r-1', name: 'Codename', kind: 'KEYWORD', definition: 'Project Falcon', risk: 'MEDIUM', action: 'WARN' }]);
  });

  it.each([
    ['null', null],
    ['no version', { policy: entries(), rules: [] }],
    ['version 0', bundle({}, [], 0)],
    ['a missing category', { version: 1, policy: entries().slice(1), rules: [] }],
    ['a duplicate category', { version: 1, policy: [...entries().slice(1), entries()[1]], rules: [] }],
    ['an unknown category', { version: 1, policy: [...entries().slice(1), { category_code: 'NAMES', action: 'WARN', enabled: true }], rules: [] }],
    ['a bad action', bundle({ CONTACT_INFO: { action: 'DENY' } })],
    ['a non-boolean enabled', bundle({ CONTACT_INFO: { enabled: 'yes' as unknown as boolean } })],
  ])('rejects the whole bundle for %s', (_name, raw) => {
    expect(parseBundle(raw)).toBeNull();
  });

  it('keeps risk_level only when it is valid, and treats it as optional', () => {
    const parsed = parseBundle(bundle({ CONTACT_INFO: { risk_level: 'HIGH' }, LOCATION: { risk_level: 'EXTREME' } }));
    expect(parsed?.policy.find((e) => e.category_code === 'CONTACT_INFO')?.risk_level).toBe('HIGH');
    expect(parsed?.policy.find((e) => e.category_code === 'LOCATION')?.risk_level).toBeUndefined();
  });

  it('drops TOPIC rules and malformed rules, keeps the others in order', () => {
    const parsed = parseBundle(
      bundle({}, [
        { ...RULE, id: 'a' },
        { ...RULE, id: 'topic', kind: 'TOPIC' },
        { ...RULE, id: 'bad-risk', risk_level: 'EXTREME' },
        { ...RULE, id: 'b', kind: 'PATTERN', definition: 'x+' },
      ]),
    );
    expect(parsed?.rules.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('bundleToPolicy', () => {
  const policyOf = (overrides: Record<string, Partial<Entry>> = {}, rules: unknown[] = []): Policy =>
    bundleToPolicy(parseBundle(bundle(overrides, rules))!);

  it('turns actions into enforcement levels and a disabled category into SAFE', () => {
    const policy = policyOf({
      AUTH_SECRETS: { action: 'BLOCK' },
      CONTACT_INFO: { action: 'WARN' },
      WEB_LINKS: { action: 'ALLOW' },
      LOCATION: { enabled: false, action: 'BLOCK' },
    });
    expect(policy.categories?.AUTH_SECRET?.tier).toBe('HIGH');
    expect(policy.categories?.CONTACT?.tier).toBe('MEDIUM');
    expect(policy.categories?.WEB_LINK?.tier).toBe('LOW');
    expect(policy.categories?.LOCATION?.tier).toBe('SAFE');
    expect(Object.keys(policy.categories ?? {})).toHaveLength(24);
  });

  it('survives validation (what the content scripts load)', () => {
    const policy = policyOf({ CONTACT_INFO: { risk_level: 'LOW' } }, [RULE]);
    const { policy: validated } = validatePolicy(JSON.parse(JSON.stringify(policy)));
    expect(validated?.categories?.CONTACT).toEqual({ tier: 'MEDIUM', risk: 'LOW' });
    expect(validated?.rules?.org).toHaveLength(1);
  });

  it('the action decides what the user sees; the bundle risk is what is reported', () => {
    const policy = policyOf({ CONTACT_INFO: { action: 'BLOCK', risk_level: 'LOW' } });
    const a = analyzePrompt('mail sara@example.com', new PlaceholderVault(), { policy });
    expect(a.decision.tier).toBe('HIGH'); // BLOCK
    expect(a.decision.risk).toBe('LOW'); // risk_level from the bundle, not the built-in MEDIUM
  });

  it('falls back to the built-in tier as the risk when the bundle has none', () => {
    const policy = policyOf({ CONTACT_INFO: { action: 'ALLOW' } });
    const a = analyzePrompt('mail sara@example.com', new PlaceholderVault(), { policy });
    expect(a.decision.tier).toBe('LOW');
    expect(a.decision.risk).toBe('MEDIUM');
  });

  it('a disabled category is neither detected nor masked', () => {
    const policy = policyOf({ CONTACT_INFO: { enabled: false } });
    const a = analyzePrompt('mail sara@example.com', new PlaceholderVault(), { policy });
    expect(a.detections).toEqual([]);
    expect(a.revised).toBe('mail sara@example.com');
  });

  it('a rule keeps its own risk and action', () => {
    const policy = policyOf({}, [{ ...RULE, risk_level: 'HIGH', action: 'BLOCK' }]);
    const a = analyzePrompt('see Project Falcon', new PlaceholderVault(), { policy });
    expect(a.decision).toMatchObject({ tier: 'HIGH', risk: 'HIGH' });
  });
});

describe('policy sync', () => {
  function setup(handler: (r: RecordedRequest) => ScriptedResponse | Promise<ScriptedResponse>, etag: string | null = null) {
    const local = new MemoryArea();
    const { fetch, requests } = scriptedFetch((r) => (r.url.endsWith('/extension/login') ? { body: TOKENS(1) } : handler(r)));
    const session = new Session({ api: { baseUrl: 'http://api.test/api', fetch }, local, session: new MemoryArea() });
    const saved: Array<{ policy: Policy; etag: string | null }> = [];
    let checked = 0;
    const sync = createPolicySync({
      session,
      getEtag: async () => etag,
      save: async (policy, newEtag) => {
        saved.push({ policy, etag: newEtag });
        return true;
      },
      onChecked: () => {
        checked += 1;
      },
    });
    return { session, sync, requests, saved, checked: () => checked };
  }

  const policyCalls = (requests: RecordedRequest[]) => requests.filter((r) => r.url.endsWith('/policy/bundle'));

  it('does nothing while signed out', async () => {
    const t = setup(() => ({ body: bundle() }));
    expect(await t.sync()).toBe('SIGNED_OUT');
    expect(t.requests).toHaveLength(0);
  });

  it('stores a new bundle with its ETag', async () => {
    const t = setup(() => ({ body: bundle({}, [RULE]), headers: { ETag: '"v7-d1"' } }));
    await t.session.login('a@example.test', 'x');
    expect(await t.sync()).toBe('UPDATED');
    expect(t.saved).toHaveLength(1);
    expect(t.saved[0]!.etag).toBe('"v7-d1"');
    expect(t.saved[0]!.policy.version).toBe(7);
    expect(t.checked()).toBe(1);
  });

  it('sends If-None-Match and keeps the stored policy on 304', async () => {
    const t = setup(() => ({ status: 304 }), '"v7-d1"');
    await t.session.login('a@example.test', 'x');
    expect(await t.sync()).toBe('UNCHANGED');
    expect(policyCalls(t.requests)[0]!.headers['If-None-Match']).toBe('"v7-d1"');
    expect(t.saved).toHaveLength(0);
    expect(t.checked()).toBe(1);
  });

  it('sends no If-None-Match when no policy is stored', async () => {
    const t = setup(() => ({ body: bundle(), headers: { ETag: '"e"' } }));
    await t.session.login('a@example.test', 'x');
    await t.sync();
    expect(policyCalls(t.requests)[0]!.headers['If-None-Match']).toBeUndefined();
  });

  it('keeps the last policy when the bundle is malformed', async () => {
    const t = setup(() => ({ body: { version: 8, policy: [], rules: [] } }));
    await t.session.login('a@example.test', 'x');
    expect(await t.sync()).toBe('INVALID');
    expect(t.saved).toHaveLength(0);
  });

  it('keeps the last policy when the server is down or unreachable', async () => {
    const down = setup(() => apiError(503, 'UNAVAILABLE'));
    await down.session.login('a@example.test', 'x');
    expect(await down.sync()).toBe('FAILED');

    const offline = setup(() => {
      throw new Error('offline');
    });
    await offline.session.login('a@example.test', 'x');
    expect(await offline.sync()).toBe('FAILED');
    expect(offline.saved).toHaveLength(0);
  });

  it('reports SIGNED_OUT when the check ends the session', async () => {
    const t = setup(() => apiError(401, 'ACCOUNT_INACTIVE'));
    await t.session.login('a@example.test', 'x');
    expect(await t.sync()).toBe('SIGNED_OUT');
  });

  it('runs one check at a time', async () => {
    const t = setup(() => ({ body: bundle() }));
    await t.session.login('a@example.test', 'x');
    await Promise.all([t.sync(), t.sync(), t.sync()]);
    expect(policyCalls(t.requests)).toHaveLength(1);
  });
});

describe('sign-in wording', () => {
  it('has a message for every sign-in error', () => {
    for (const code of ['INVALID_CREDENTIALS', 'ACCOUNT_NO_ACCESS', 'ACCOUNT_INACTIVE', 'RATE_LIMITED', 'NETWORK_ERROR', 'OTHER']) {
      expect(loginErrorMessage(code, 5).length).toBeGreaterThan(10);
    }
    expect(loginErrorMessage('RATE_LIMITED', 30)).toContain('30 seconds');
  });

  it('explains an ended session, but not a sign-out the user chose', () => {
    expect(signedOutMessage('USER')).toBeNull();
    expect(signedOutMessage(undefined)).toBeNull();
    expect(signedOutMessage('SESSION_EXPIRED')).toContain('sign in again');
    expect(signedOutMessage('ACCOUNT_INACTIVE')).toContain('deactivated');
  });
});
