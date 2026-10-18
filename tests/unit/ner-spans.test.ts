import { describe, expect, it } from 'vitest';
import { joinAddressPieces } from '../../src/ner/runner';
import { aggregateBio, alignTokens, toWords, trimSpan, type TokenPrediction } from '../../src/ner/spans';

/** A fake tokenizer: pieces as the real one would decode them, incl. the leading-space quirk. */
function fakeAlign(text: string, pieces: string[], specialIndexes: number[] = []) {
  const special = new Set(specialIndexes);
  const decodePrefix = (n: number) =>
    pieces.slice(0, n).filter((_, i) => !special.has(i)).join('');
  return alignTokens(text, pieces.length, decodePrefix, (i) => special.has(i));
}

function tok(tag: string, start: number | null, end: number | null, score = 0.9): TokenPrediction {
  return { tag, score, start, end };
}

describe('alignTokens', () => {
  it('handles the tokenizer adding a leading space (entity at the very start)', () => {
    const text = 'Ahmed Al-Harbi will';
    const spans = fakeAlign(text, ['<bos>', ' Ahmed', ' Al', '-', 'Har', 'bi', ' will'], [0]);
    expect(spans[0]).toBeNull();
    expect(spans.slice(1).map((s) => s && text.slice(s[0], s[1]))).toEqual(['Ahmed', 'Al', '-', 'Har', 'bi', 'will']);
  });

  it('aligns Arabic sub-word pieces', () => {
    const text = 'لزميلي فهد الدوسري';
    const spans = fakeAlign(text, [' ل', 'زم', 'يلي', ' ف', 'هد', ' الد', 'وس', 'ري']);
    expect(spans.map((s) => s && text.slice(s[0], s[1]))).toEqual(['ل', 'زم', 'يلي', 'ف', 'هد', 'الد', 'وس', 'ري']);
  });
});

describe('toWords + aggregateBio', () => {
  it('a word takes the tag of its first piece (suffix tagged B- is ignored)', () => {
    // "لزميلي" = ل|زم|يلي, the model wrongly tags the suffix "يلي" as B-PERSON.
    const tokens = [
      tok('O', 0, 1), tok('O', 1, 3), tok('B-PERSON', 3, 6),
      tok('I-PERSON', 7, 8), tok('I-PERSON', 8, 10),
      tok('I-PERSON', 11, 14), tok('I-PERSON', 14, 16), tok('I-PERSON', 16, 18),
    ];
    const entities = aggregateBio(toWords(tokens));
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ type: 'PERSON', start: 7, end: 18 });
  });

  it('separates two different entities and skips O words', () => {
    const tokens = [tok('B-PERSON', 0, 4), tok('O', 5, 8), tok('B-STREET_ADDRESS', 9, 11), tok('I-STREET_ADDRESS', 12, 16)];
    expect(aggregateBio(toWords(tokens)).map((e) => [e.type, e.start, e.end])).toEqual([
      ['PERSON', 0, 4],
      ['STREET_ADDRESS', 9, 16],
    ]);
  });

  it('ignores special / unaligned tokens', () => {
    expect(aggregateBio(toWords([tok('B-PERSON', null, null), tok('O', 0, 3)]))).toEqual([]);
  });
});

describe('trimSpan', () => {
  it('drops punctuation and spaces at the edges, Latin and Arabic', () => {
    const text = 'at 4521 Oak Avenue, then';
    expect(trimSpan(text, 3, 19)).toEqual([3, 18]);
    const ar = 'حي النرجس، الرياض';
    expect(ar.slice(...trimSpan(ar, 0, 10))).toBe('حي النرجس');
  });
});

describe('joinAddressPieces', () => {
  it('joins an Arabic address split by "رقم" and adds the street word before it', () => {
    const text = 'المستأجر في شارع التحلية رقم 45 متأخر';
    const a = text.indexOf('التحلية');
    const b = text.indexOf('45');
    const joined = joinAddressPieces(text, [
      { type: 'STREET_ADDRESS', start: a, end: a + 'التحلية'.length, score: 0.83 },
      { type: 'STREET_ADDRESS', start: b, end: b + 2, score: 0.99 },
    ]);
    expect(joined).toHaveLength(1);
    expect(text.slice(joined[0]!.start, joined[0]!.end)).toBe('شارع التحلية رقم 45');
  });

  it('does not join addresses separated by other words, or other entity types', () => {
    const text = 'Ali Hassan and 12 Baker Street';
    const spans = [
      { type: 'PERSON', start: 0, end: 10, score: 1 },
      { type: 'STREET_ADDRESS', start: 15, end: 30, score: 1 },
    ];
    expect(joinAddressPieces(text, spans)).toHaveLength(2);
  });
});
