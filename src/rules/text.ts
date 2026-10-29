/**
 * Hares AI — text normalisation for KEYWORD rules.
 *
 * Agreed with the backend: whole-word matching, case-insensitive for Latin
 * letters, Arabic letter variants folded (alef forms → ا, ة → ه, ى → ي) and
 * diacritics ignored. Normalising removes characters, so a map back to offsets
 * in the original text is kept: masking and highlighting need those offsets.
 */

/** Tatweel and Arabic marks (harakat, shadda, sukun, dagger alef, Quranic marks). */
function isIgnorable(code: number): boolean {
  return (
    code === 0x0640 ||
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4) ||
    code === 0x06e7 ||
    code === 0x06e8 ||
    (code >= 0x06ea && code <= 0x06ed)
  );
}

const FOLD: Readonly<Record<string, string>> = {
  'أ': 'ا',
  'إ': 'ا',
  'آ': 'ا',
  'ٱ': 'ا',
  'ة': 'ه',
  'ى': 'ي',
};

function foldChar(ch: string): string {
  const folded = FOLD[ch];
  if (folded) return folded;
  const lower = ch.toLowerCase();
  // Keep the original when lower-casing would change the length (e.g. "İ").
  return lower.length === ch.length ? lower : ch;
}

export interface NormalizedText {
  text: string;
  /** Maps a [start, end) range of `text` back to a range of the original string. */
  toOriginal(start: number, end: number): [number, number];
}

export function normalizeWithMap(original: string): NormalizedText {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const ch of original) {
    const next = index + ch.length;
    const code = ch.codePointAt(0) ?? 0;
    if (!isIgnorable(code)) {
      const out = foldChar(ch);
      text += out;
      for (let i = 0; i < out.length; i += 1) {
        starts.push(index);
        ends.push(next);
      }
    }
    index = next;
  }
  return {
    text,
    toOriginal(start, end) {
      const from = starts[start] ?? 0;
      let to = ends[end - 1] ?? original.length;
      // Take trailing marks with the word, so none is left behind when it is masked.
      while (to < original.length && isIgnorable(original.charCodeAt(to))) to += 1;
      return [from, to];
    },
  };
}

/** Normalise a keyword definition (no offset map needed). */
export function normalizeKeyword(text: string): string {
  return normalizeWithMap(text).text;
}
