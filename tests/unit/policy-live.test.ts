import { beforeEach, describe, expect, it, vi } from 'vitest';

type Changes = Record<string, { newValue?: unknown; oldValue?: unknown }>;

const fake = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  listeners: [] as Array<(changes: Changes, area: string) => void>,
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in fake.data).map((k) => [k, fake.data[k]]));
        },
        set: async (items: Record<string, unknown>) => Object.assign(fake.data, items),
      },
      onChanged: { addListener: (fn: (changes: Changes, area: string) => void) => fake.listeners.push(fn) },
    },
  },
}));

import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt } from '../../src/pipeline/analyze';
import { bundleToPolicy, parseBundle } from '../../src/policy/bundle';
import { CATEGORY_CODES } from '../../src/contract/categories';
import { POLICY_KEY, PolicyState } from '../../src/policy/store';

function policyV(version: number, bankingEnabled: boolean) {
  const policy = CATEGORY_CODES.map((code) => ({
    category_code: code,
    action: 'WARN',
    enabled: code === 'FINANCIAL_BANKING' ? bankingEnabled : true,
  }));
  const bundle = parseBundle({ version, policy, rules: [] });
  if (!bundle) throw new Error('test bundle rejected');
  return bundleToPolicy(bundle);
}

const CARD_TEXT = 'my card is 4111 1111 1111 1111';
const scan = (state: PolicyState) => analyzePrompt(CARD_TEXT, new PlaceholderVault(), { policy: state.policy, exceptions: state.exceptions });

beforeEach(() => {
  fake.data = {};
  fake.listeners = [];
});

describe('an open page follows policy changes without a reload', () => {
  it('a storage change event replaces the page copy', async () => {
    fake.data[POLICY_KEY] = policyV(15, true);
    const state = new PolicyState();
    await state.start();
    expect(scan(state).detections.length).toBeGreaterThan(0);

    const next = policyV(16, false);
    fake.data[POLICY_KEY] = next;
    for (const listener of fake.listeners) listener({ [POLICY_KEY]: { newValue: next } }, 'local');
    expect(state.policy.version).toBe(16);
    expect(scan(state).detections).toEqual([]);
  });

  it('even when the change event never arrives, the next scan reads the stored policy', async () => {
    fake.data[POLICY_KEY] = policyV(15, true);
    const state = new PolicyState();
    await state.start();
    expect(scan(state).detections.length).toBeGreaterThan(0);

    fake.data[POLICY_KEY] = policyV(16, false); // stored, but no event reaches the page
    expect(state.policy.version).toBe(15);
    await state.refresh(); // what a scan does first
    expect(state.policy.version).toBe(16);
    expect(scan(state).detections).toEqual([]);
  });

  it('a page that started before any policy was stored picks it up on the next scan', async () => {
    const state = new PolicyState();
    await state.start();
    expect(scan(state).detections.length).toBeGreaterThan(0);
    fake.data[POLICY_KEY] = policyV(3, false);
    await state.refresh();
    expect(scan(state).detections).toEqual([]);
  });

  it('keeps the current policy if storage cannot be read', async () => {
    fake.data[POLICY_KEY] = policyV(15, true);
    const state = new PolicyState();
    await state.start();
    vi.spyOn(fake, 'data', 'get').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    await expect(state.refresh()).resolves.toBeUndefined();
    expect(state.policy.version).toBe(15);
  });
});
