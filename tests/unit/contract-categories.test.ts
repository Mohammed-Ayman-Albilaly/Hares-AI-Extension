import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../src/detectors/categories';
import { PATTERNS } from '../../src/detectors/patterns';
import { CATEGORY_CODES, CONTRACT_CODE, isCategoryCode, toContractCode } from '../../src/contract/categories';
import { MODEL_LABELS } from '../../src/ner/labels';

describe('contract category codes', () => {
  it('there are exactly 24 distinct codes', () => {
    expect(CATEGORY_CODES).toHaveLength(24);
    expect(new Set(CATEGORY_CODES).size).toBe(24);
  });

  it('every internal category maps to a distinct contract code', () => {
    const ids = Object.keys(CATEGORIES);
    expect(Object.keys(CONTRACT_CODE).sort()).toEqual([...ids].sort());
    const codes = ids.map((id) => toContractCode(id as keyof typeof CATEGORIES));
    expect(new Set(codes).size).toBe(ids.length);
    for (const code of codes) expect(isCategoryCode(code), code).toBe(true);
  });

  it('all 24 codes are reachable (no code is left without a category)', () => {
    expect([...new Set(Object.values(CONTRACT_CODE))].sort()).toEqual([...CATEGORY_CODES].sort());
  });

  it('every detection-model label maps to exactly one category with a contract code', () => {
    expect(Object.keys(MODEL_LABELS)).toHaveLength(29);
    for (const [label, mapping] of Object.entries(MODEL_LABELS)) {
      expect(isCategoryCode(toContractCode(mapping.category)), label).toBe(true);
    }
  });

  it('every rule pattern uses a category with a contract code', () => {
    for (const p of PATTERNS) expect(isCategoryCode(toContractCode(p.category)), p.id).toBe(true);
  });

  it('agreed mapping for the model labels', () => {
    const code = (label: string) => toContractCode(MODEL_LABELS[label]!.category);
    expect(code('PERSON')).toBe('PERSONAL_IDENTITY');
    expect(code('AGE')).toBe('PERSONAL_IDENTITY');
    expect(code('EMAIL')).toBe('CONTACT_INFO');
    expect(code('PASSWORD')).toBe('AUTH_SECRETS');
    expect(code('SECRET')).toBe('AUTH_SECRETS');
    expect(code('STREET_ADDRESS')).toBe('LOCATION');
    expect(code('DEVICE_ID')).toBe('DIGITAL_FINGERPRINTS');
    expect(code('LICENSE_NUMBER')).toBe('LEGAL_GOVERNMENT');
  });

  it('Saudi ID and IBAN are never reported as REGION_BANKING_IDENTITY', () => {
    const byId = (id: string) => PATTERNS.find((p) => p.id === id)!;
    expect(toContractCode(byId('saudi-id').category)).toBe('PERSONAL_IDENTITY');
    expect(toContractCode(byId('iban').category)).toBe('FINANCIAL_BANKING');
    const used = new Set(PATTERNS.map((p) => toContractCode(p.category)));
    expect(used.has('REGION_BANKING_IDENTITY')).toBe(false);
    expect(used.has('UNIVERSAL_IDS')).toBe(false);
  });
});
