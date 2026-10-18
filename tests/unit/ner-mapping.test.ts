import { describe, expect, it } from 'vitest';
import { PlaceholderVault } from '../../src/masking/vault';
import { entitiesToDetections } from '../../src/ner/mapping';
import type { EntitySpan } from '../../src/ner/spans';
import { analyzePrompt } from '../../src/pipeline/analyze';

function span(text: string, value: string, type: string, score = 0.95): EntitySpan {
  const start = text.indexOf(value);
  return { type, start, end: start + value.length, score };
}

describe('entitiesToDetections', () => {
  const text = 'اسمي محمد العتيبي وأسكن في حي النرجس، الرياض';

  it('maps model types to our categories and placeholder labels', () => {
    const d = entitiesToDetections(text, [span(text, 'محمد العتيبي', 'PERSON'), span(text, 'حي النرجس', 'STREET_ADDRESS')]);
    expect(d.map((x) => [x.category, x.label, x.value, x.source])).toEqual([
      ['PERSONAL_NAME', 'PERSON', 'محمد العتيبي', 'ner'],
      ['LOCATION', 'ADDRESS', 'حي النرجس', 'ner'],
    ]);
  });

  it('drops types that are off by default (city names) unless a policy enables them', () => {
    const city = [span(text, 'الرياض', 'LOCATION')];
    expect(entitiesToDetections(text, city)).toEqual([]);
    expect(entitiesToDetections(text, city, ['LOCATION'])).toHaveLength(1);
  });

  it('drops low-confidence results', () => {
    expect(entitiesToDetections('What did Steve Jobs say?', [span('What did Steve Jobs say?', 'Steve Jobs', 'PERSON', 0.65)])).toEqual([]);
  });

  it('a model "credit card" must pass Luhn, a Saudi-format ID its checksum', () => {
    const t = 'card 4111 1111 1111 1112 and id 1087654322';
    expect(entitiesToDetections(t, [span(t, '4111 1111 1111 1112', 'CREDIT_CARD'), span(t, '1087654322', 'NATIONAL_ID')])).toEqual([]);
    const ok = 'card 4111 1111 1111 1111';
    expect(entitiesToDetections(ok, [span(ok, '4111 1111 1111 1111', 'CREDIT_CARD')])).toHaveLength(1);
  });

  it('ignores spans outside the text', () => {
    expect(entitiesToDetections('short', [{ type: 'PERSON', start: 2, end: 99, score: 1 }])).toEqual([]);
  });
});

describe('analysis with model detections', () => {
  it('masks names and addresses found by the model, alongside the rules', () => {
    const text = 'Send the contract to Sarah Mitchell at sara@example.com';
    const modelDetections = entitiesToDetections(text, [span(text, 'Sarah Mitchell', 'PERSON')]);
    const a = analyzePrompt(text, new PlaceholderVault(), { modelDetections });
    expect(a.revised).toBe('Send the contract to [PERSON_1] at [EMAIL_1]');
    expect(a.decision.tier).toBe('MEDIUM');
  });

  it('on overlap the rule detection wins over the model', () => {
    const text = 'mail sara@example.com';
    const modelDetections = entitiesToDetections(text, [span(text, 'sara@example.com', 'PERSON')]);
    const a = analyzePrompt(text, new PlaceholderVault(), { modelDetections });
    expect(a.detections).toHaveLength(1);
    expect(a.detections[0]?.source).toBe('rule');
    expect(a.revised).toBe('mail [EMAIL_1]');
  });

  it('a policy can switch names off', () => {
    const text = 'Write to Sarah Mitchell';
    const modelDetections = entitiesToDetections(text, [span(text, 'Sarah Mitchell', 'PERSON')]);
    const a = analyzePrompt(text, new PlaceholderVault(), {
      modelDetections,
      policy: { version: 1, departmentId: 'x', labels: { PERSON: { tier: 'SAFE' } } },
    });
    expect(a.decision.tier).toBe('SAFE');
    expect(a.revised).toBe(text);
  });
});
