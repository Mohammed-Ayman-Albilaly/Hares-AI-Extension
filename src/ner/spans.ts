/**
 * Hares AI — turn per-token model predictions into character spans.
 *
 * Transformers.js token classification gives no character offsets, but masking
 * needs exact positions in the user's text. So:
 *  1. `alignTokens` maps each token to a [start, end) range in the original
 *     text by decoding growing prefixes of the token ids (this handles
 *     multi-byte Arabic and byte-fallback tokens), with a search fallback when
 *     the decoded text differs from the input.
 *  2. `aggregateBio` groups B-/I- tags into entity spans.
 * Both are pure, so they are unit-tested without a model.
 */

export interface TokenPrediction {
  /** Model tag, e.g. "B-PERSON", "I-PERSON", "O". */
  tag: string;
  score: number;
  /** Character range in the original text; null for special or unaligned tokens. */
  start: number | null;
  end: number | null;
}

export interface EntitySpan {
  /** Model entity type, e.g. "PERSON". */
  type: string;
  start: number;
  end: number;
  /** Mean token score. */
  score: number;
}

/**
 * Character range of each token in `text`.
 * `decodePrefix(n)` must return the decoded text of the first n tokens with
 * special tokens skipped.
 */
export function alignTokens(
  text: string,
  tokenCount: number,
  decodePrefix: (n: number) => string,
  isSpecial: (index: number) => boolean,
): Array<[number, number] | null> {
  const spans: Array<[number, number] | null> = [];
  const full = decodePrefix(tokenCount);
  const sameText = full === text || full.trim() === text.trim();
  const lead = sameText ? text.length - text.trimStart().length - (full.length - full.trimStart().length) : 0;

  let previous = '';
  let cursor = 0;
  for (let i = 0; i < tokenCount; i += 1) {
    if (isSpecial(i)) {
      spans.push(null);
      continue;
    }
    const current = decodePrefix(i + 1);
    if (sameText) {
      // Offsets in the decoded text equal offsets in the input, shifted by
      // `lead` (the tokenizer adds a leading space the input does not have).
      let start = Math.max(0, previous.length + lead);
      const end = current.length + lead;
      // Do not include the leading space a token carries.
      while (start < end && /\s/.test(text[start] ?? '')) start += 1;
      spans.push(start < end ? [start, end] : null);
    } else {
      // Fallback: locate the token's own text after the cursor.
      const piece = current.slice(previous.length).trim();
      const at = piece ? text.indexOf(piece, cursor) : -1;
      if (at >= 0 && at - cursor < 40) {
        spans.push([at, at + piece.length]);
        cursor = at + piece.length;
      } else {
        spans.push(null);
      }
    }
    previous = current;
  }
  return spans;
}

/**
 * Merge sub-word tokens into words: tokens with no gap between them belong to
 * the same word, and the word takes the tag of its FIRST token (the "first"
 * strategy). Without this the model can tag a suffix ("يلي" of "لزميلي") as the
 * start of a name, or skip a word's first piece ("شار" of "شارع").
 */
export function toWords(tokens: readonly TokenPrediction[]): TokenPrediction[] {
  const words: TokenPrediction[] = [];
  for (const t of tokens) {
    if (t.start === null || t.end === null) continue;
    const last = words[words.length - 1];
    if (last && last.end === t.start) {
      last.end = t.end; // same word: keep the first token's tag and score
    } else {
      words.push({ ...t });
    }
  }
  return words;
}

/** Punctuation that should not be part of an entity's edges (Latin + Arabic). */
const EDGE_PUNCT = /[\s.,;:!?،؛؟"'()[\]{}«»]/;

/** Trim spaces and punctuation from both ends of a span. */
export function trimSpan(text: string, start: number, end: number): [number, number] {
  while (start < end && EDGE_PUNCT.test(text[start] ?? '')) start += 1;
  while (end > start && EDGE_PUNCT.test(text[end - 1] ?? '')) end -= 1;
  return [start, end];
}

/** Group BIO-tagged tokens into entity spans (an I- tag with no B- starts a new entity). */
export function aggregateBio(tokens: readonly TokenPrediction[]): EntitySpan[] {
  const entities: EntitySpan[] = [];
  let current: { type: string; start: number; end: number; scores: number[] } | null = null;

  const flush = (): void => {
    if (current) {
      const score = current.scores.reduce((a, b) => a + b, 0) / current.scores.length;
      entities.push({ type: current.type, start: current.start, end: current.end, score });
    }
    current = null;
  };

  for (const t of tokens) {
    if (t.start === null || t.end === null) continue; // special / unaligned
    const [prefix, type] = t.tag.includes('-') ? (t.tag.split('-', 2) as [string, string]) : ['O', ''];
    if (prefix === 'O' || !type) {
      flush();
      continue;
    }
    if (prefix === 'I' && current && current.type === type) {
      current.end = t.end;
      current.scores.push(t.score);
      continue;
    }
    // A sub-word of the same word continuing an entity, tagged B again, is still the same entity.
    if (prefix === 'B' && current && current.type === type && t.start === current.end) {
      current.end = t.end;
      current.scores.push(t.score);
      continue;
    }
    flush();
    current = { type, start: t.start, end: t.end, scores: [t.score] };
  }
  flush();
  return entities;
}
