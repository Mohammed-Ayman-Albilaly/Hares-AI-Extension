import { describe, expect, it } from 'vitest';
import { detectWithRules } from '../../src/detectors/rules';
import { PlaceholderVault } from '../../src/masking/vault';
import type { ClassifyResult } from '../../src/model/contract';
import { decide } from '../../src/policy/decision';

const PROMPT =
  'Send the report to sara@example.com and ali@example.com, cc sara@example.com. API key: sk-proj-abcdEFGH1234ijklMNOP5678';

function context(top: string, top_score = 0.9): ClassifyResult {
  return {
    labels: [top],
    scores: [top_score],
    top,
    top_score,
    input_tokens: 10,
    latency_ms: 1,
    uncertain: top_score < 0.4,
  };
}

describe('PlaceholderVault', () => {
  it('masks with consistent numbered placeholders and leaves no raw value', () => {
    const vault = new PlaceholderVault();
    const detections = detectWithRules(PROMPT);
    const { masked } = vault.mask(PROMPT, detections);
    expect(masked).toBe(
      'Send the report to [EMAIL_1] and [EMAIL_2], cc [EMAIL_1]. API key: [API_KEY_1]',
    );
    for (const d of detections) expect(masked).not.toContain(d.value);
  });

  it('round-trips mask → unmask to the original text', () => {
    const vault = new PlaceholderVault();
    const { masked } = vault.mask(PROMPT, detectWithRules(PROMPT));
    expect(vault.unmask(masked)).toBe(PROMPT);
  });

  it('keeps placeholders stable across prompts in one conversation', () => {
    const vault = new PlaceholderVault();
    vault.mask(PROMPT, detectWithRules(PROMPT));
    const next = 'Did ali@example.com reply?';
    expect(vault.mask(next, detectWithRules(next)).masked).toBe('Did [EMAIL_2] reply?');
  });

  it('restores from a snapshot and continues numbering', () => {
    const vault = new PlaceholderVault();
    vault.mask(PROMPT, detectWithRules(PROMPT));
    const restored = PlaceholderVault.fromSnapshot(vault.snapshot());
    expect(restored.unmask('[EMAIL_1]')).toBe('sara@example.com');
    expect(restored.placeholderFor('EMAIL', 'new@example.com')).toBe('[EMAIL_3]');
  });

  it('does not mask keyword-only detections', () => {
    const text = 'this is confidential';
    const vault = new PlaceholderVault();
    expect(vault.mask(text, detectWithRules(text)).masked).toBe(text);
  });

  it('leaves unknown placeholders untouched on unmask', () => {
    expect(new PlaceholderVault().unmask('hello [EMAIL_9]')).toBe('hello [EMAIL_9]');
  });
});

describe('decide', () => {
  it('SAFE: plain send, no UI', () => {
    const d = decide([], context('safe'));
    expect(d.tier).toBe('SAFE');
    expect(d.presentation).toBe('none');
    expect(d.actions).toEqual(['send']);
  });

  it('LOW: keyword only → notice, send allowed, nothing to mask', () => {
    const d = decide(detectWithRules('this is confidential'), context('safe'));
    expect(d.tier).toBe('LOW');
    expect(d.presentation).toBe('notice');
    expect(d.actions).toEqual(['send', 'edit']);
  });

  it('MEDIUM: contact data → confirm, masked send offered', () => {
    const d = decide(detectWithRules('mail sara@example.com'), context('safe'));
    expect(d.tier).toBe('MEDIUM');
    expect(d.actions).toEqual(['confirm_send', 'send_masked', 'edit', 'cancel']);
  });

  it('HIGH: original send is never allowed, masked send is', () => {
    const d = decide(detectWithRules(PROMPT), context('safe'));
    expect(d.tier).toBe('HIGH');
    expect(d.presentation).toBe('block');
    expect(d.actions).not.toContain('send');
    expect(d.actions).not.toContain('confirm_send');
    expect(d.actions).toContain('send_masked');
    expect(d.categories[0]).toBe('AUTH_SECRET');
  });

  it('context model alone is capped at MEDIUM', () => {
    expect(decide([], context('high')).tier).toBe('MEDIUM');
  });

  it('uncertain context escalates to MEDIUM', () => {
    expect(decide([], context('safe', 0.3)).tier).toBe('MEDIUM');
  });

  it('works without a context result (model unavailable)', () => {
    expect(decide(detectWithRules(PROMPT), null).tier).toBe('HIGH');
    expect(decide([], null).tier).toBe('SAFE');
  });
});
