import { describe, expect, it } from 'vitest';
import { detectWithRules } from '../../src/detectors/rules';
import { ApprovalStore } from '../../src/interceptor/approval';
import { PlaceholderVault } from '../../src/masking/vault';
import { ConversationTracker } from '../../src/pipeline/conversation';
import { analyzePrompt } from '../../src/pipeline/analyze';

const SECRET_PROMPT = 'my password is Hunter2! and key sk-proj-abcdEFGH1234ijklMNOP5678, mail sara@example.com';

describe('ApprovalStore (loop prevention)', () => {
  it('lets the approved text through for the whole send window, then expires', () => {
    let t = 0;
    const store = new ApprovalStore(2000, () => t);
    store.approveOnce('hello  world');
    expect(store.allows('hello world')).toBe(true); // click
    expect(store.allows('hello world')).toBe(true); // submit fired by the same send
    t = 2001;
    expect(store.allows('hello world')).toBe(false);
  });

  it('does not let a different (edited) text through', () => {
    const store = new ApprovalStore();
    store.approveOnce('send this');
    expect(store.allows('send this and my password is x1y2z3')).toBe(false);
  });

  it('keeps revised texts trusted for the session (copy-paste case)', () => {
    let t = 0;
    const store = new ApprovalStore(2000, () => t);
    store.trust('mail [EMAIL_1]\nnow');
    t = 10 * 60_000;
    expect(store.allows('mail [EMAIL_1] now')).toBe(true);
  });
});

describe('re-analysing a revised prompt', () => {
  it('never flags placeholders as sensitive data again', () => {
    const vault = new PlaceholderVault();
    const first = analyzePrompt(SECRET_PROMPT, vault);
    expect(first.decision.tier).toBe('HIGH');

    const values = detectWithRules(first.revised).filter((d) => d.category !== 'KEYWORD');
    expect(values).toEqual([]);
  });

  it('placeholder names alone do not count as keywords', () => {
    const detections = detectWithRules('use [PASSWORD_1] with [API_KEY_1] and [BEARER_TOKEN_1]');
    expect(detections).toEqual([]);
  });

  it('reports findings without raw values, highest tier first', () => {
    const analysis = analyzePrompt(SECRET_PROMPT, new PlaceholderVault());
    expect(analysis.findings[0]?.tier).toBe('HIGH');
    expect(JSON.stringify(analysis.findings)).not.toContain('Hunter2');
    expect(analysis.findings.map((f) => f.placeholder)).toContain('[EMAIL_1]');
  });
});

describe('ConversationTracker', () => {
  it('follows a new chat to its own URL after the first send', () => {
    let path = '/';
    let t = 0;
    const tracker = new ConversationTracker(() => path, () => t);
    const first = tracker.current();
    first.vault.placeholderFor('EMAIL', 'sara@example.com');
    tracker.recordSend('hi');
    path = '/c/abc123';
    t = 2000;
    const moved = tracker.current();
    expect(moved).toBe(first);
    expect(moved.historyTail()).toBe('hi');
  });

  it('starts fresh when the user opens a different conversation later', () => {
    let path = '/c/one';
    let t = 0;
    const tracker = new ConversationTracker(() => path, () => t);
    const one = tracker.current();
    tracker.recordSend('hello');
    path = '/c/two';
    t = 5 * 60_000;
    expect(tracker.current()).not.toBe(one);
    path = '/c/one';
    expect(tracker.current()).toBe(one);
  });
});
