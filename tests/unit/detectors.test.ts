import { describe, expect, it } from 'vitest';
import { mergeDetections } from '../../src/detectors/merge';
import { detectWithRules, normalizeDigits } from '../../src/detectors/rules';
import type { Detection } from '../../src/detectors/types';
import { card, iban, jwt, luhn, saudiId } from '../../src/detectors/validators';

// Synthetic test fixtures — checksum-valid, not real accounts.
const CARD = '4111 1111 1111 1111';
const SAUDI_ID = '1087654321';
const IQAMA = '2100000005';
const SAUDI_IBAN = 'SA03 8000 0000 6080 1016 7519';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

function labels(text: string): string[] {
  return detectWithRules(text).map((d) => d.label);
}

describe('validators', () => {
  it('luhn / card', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(card(CARD)).toBe(true);
    expect(card('4111 1111 1111 1112')).toBe(false);
    expect(card('0000000000000000')).toBe(false);
  });

  it('saudi national id / iqama', () => {
    expect(saudiId(SAUDI_ID)).toBe(true);
    expect(saudiId(IQAMA)).toBe(true);
    expect(saudiId('1087654322')).toBe(false);
    expect(saudiId('3087654321')).toBe(false);
  });

  it('iban mod-97 and country length', () => {
    expect(iban(SAUDI_IBAN)).toBe(true);
    expect(iban('SA03 8000 0000 6080 1016 7518')).toBe(false);
    expect(iban('SA03 8000 0000 6080 1016 751')).toBe(false);
  });

  it('jwt header must decode to JSON with alg', () => {
    expect(jwt(JWT)).toBe(true);
    expect(jwt('eyJub3RoaW5nIjoxfQ.eyJ4IjoxfQ.abc')).toBe(false);
  });
});

describe('detectWithRules', () => {
  it('finds structured secrets with the right labels and offsets', () => {
    const text = `email me at sara@example.com, card ${CARD}, id ${SAUDI_ID}`;
    const found = detectWithRules(text);
    expect(found.map((d) => d.label)).toEqual(['EMAIL', 'CARD_NUMBER', 'NATIONAL_ID']);
    for (const d of found) expect(text.slice(d.start, d.end)).toBe(d.value);
  });

  it('detects API keys, JWT, connection strings, private keys', () => {
    expect(labels('key: sk-proj-abcdEFGH1234ijklMNOP5678')).toContain('API_KEY');
    expect(labels('AWS AKIAIOSFODNN7EXAMPLE')).toContain('API_KEY');
    expect(labels(`token ${JWT}`)).toContain('JWT');
    expect(labels('DATABASE_URL=postgres://admin:hunter2@db.internal:5432/prod')).toContain(
      'CONNECTION_STRING',
    );
    expect(labels('-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----')).toEqual([
      'PRIVATE_KEY',
    ]);
  });

  it('masks only the value after a password keyword', () => {
    const [d] = detectWithRules('my password is Hunter2!').filter((x) => x.label === 'PASSWORD');
    expect(d?.value).toBe('Hunter2!');
  });

  it('does not treat free text after "password" as a password', () => {
    expect(labels('I need a password reset link')).not.toContain('PASSWORD');
  });

  it('handles Arabic keywords and Eastern-Arabic digits', () => {
    expect(normalizeDigits('١٠٨٧٦٥٤٣٢١')).toBe(SAUDI_ID);
    const found = detectWithRules('رقم الهوية ١٠٨٧٦٥٤٣٢١ وكلمة المرور: abc12345');
    const id = found.find((d) => d.label === 'NATIONAL_ID');
    expect(id?.value).toBe('١٠٨٧٦٥٤٣٢١');
    expect(found.map((d) => d.label)).toContain('PASSWORD');
  });

  it('detects Saudi IBAN and mobile numbers', () => {
    expect(labels(`حوّل على ${SAUDI_IBAN}`)).toContain('IBAN');
    expect(labels('call 0551234567 or +966 55 123 4567')).toEqual(['PHONE', 'PHONE']);
  });

  it('rejects look-alikes that fail validation', () => {
    expect(labels('order total 4111 1111 1111 1112')).not.toContain('CARD_NUMBER');
    expect(labels('just a normal sentence about the weather')).toEqual([]);
  });

  it('reports keywords without other detections', () => {
    expect(detectWithRules('this is confidential').map((d) => d.category)).toEqual(['KEYWORD']);
  });
});

describe('mergeDetections', () => {
  const base = { value: 'x', source: 'rule' as const, confidence: 1 };

  it('keeps the higher-tier span on overlap and sorts by start', () => {
    const spans: Detection[] = [
      { ...base, category: 'NUMERIC', label: 'NUMBER', start: 10, end: 20 },
      { ...base, category: 'PERSONAL_IDENTITY', label: 'NATIONAL_ID', start: 10, end: 20 },
      { ...base, category: 'CONTACT', label: 'EMAIL', start: 0, end: 5 },
      { ...base, category: 'WEB_LINK', label: 'URL', start: 15, end: 30 },
    ];
    expect(mergeDetections(spans).map((d) => d.label)).toEqual(['EMAIL', 'NATIONAL_ID']);
  });
});
