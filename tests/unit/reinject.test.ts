import { describe, expect, it } from 'vitest';
import { reinjectContentScripts, type ManifestContentScript } from '../../src/runtime/reinject';

const SCRIPTS: ManifestContentScript[] = [
  { matches: ['https://chatgpt.com/*'], js: ['content-scripts/chatgpt.js'] },
  { matches: ['https://claude.ai/*'], js: ['content-scripts/claude.js'] },
];

function setup(tabsByMatch: Record<string, Array<{ id?: number }>>, failing: number[] = []) {
  const injected: Array<[number, string[]]> = [];
  const deps = {
    contentScripts: SCRIPTS,
    queryTabs: async (matches: string[]) => tabsByMatch[matches[0]!] ?? [],
    inject: async (tabId: number, files: string[]) => {
      if (failing.includes(tabId)) throw new Error('Cannot access contents of the page');
      injected.push([tabId, files]);
    },
  };
  return { deps, injected };
}

describe('reinjectContentScripts', () => {
  it('injects each script into the open tabs it matches', async () => {
    const t = setup({ 'https://chatgpt.com/*': [{ id: 1 }, { id: 2 }], 'https://claude.ai/*': [{ id: 3 }] });
    expect(await reinjectContentScripts(t.deps)).toBe(3);
    expect(t.injected).toEqual([
      [1, ['content-scripts/chatgpt.js']],
      [2, ['content-scripts/chatgpt.js']],
      [3, ['content-scripts/claude.js']],
    ]);
  });

  it('skips a tab it cannot script and carries on with the others', async () => {
    const t = setup({ 'https://chatgpt.com/*': [{ id: 1 }, { id: 2 }] }, [1]);
    expect(await reinjectContentScripts(t.deps)).toBe(1);
    expect(t.injected).toEqual([[2, ['content-scripts/chatgpt.js']]]);
  });

  it('does nothing when no tab is open, or a tab has no id', async () => {
    const t = setup({ 'https://chatgpt.com/*': [{}] });
    expect(await reinjectContentScripts(t.deps)).toBe(0);
    expect(t.injected).toEqual([]);
  });

  it('survives a failing tab query', async () => {
    const t = setup({});
    t.deps.queryTabs = async () => {
      throw new Error('no access');
    };
    expect(await reinjectContentScripts(t.deps)).toBe(0);
  });
});
