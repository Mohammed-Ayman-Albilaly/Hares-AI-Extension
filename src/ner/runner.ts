/**
 * Hares AI — run the detection model on a prompt and return character spans.
 *
 * Shared by the browser worker and the Node evaluation script, so both measure
 * exactly the same code. Long prompts are split into overlapping character
 * windows (the model reads at most MAX_TOKENS tokens at a time).
 */

import {
  aggregateBio,
  alignTokens,
  toWords,
  trimSpan,
  type EntitySpan,
  type TokenPrediction,
} from './spans';

/** Pinned model: never a moving branch. */
export const NER_MODEL = {
  id: 'Horizon-Labs/pii-redactor-small',
  revision: '8bfbc15e90a044607264a21c3669385b4c3d748d',
  /** onnx/model_quantized.onnx (int8, ~268 MB). */
  dtype: 'q8',
} as const;

const MAX_TOKENS = 512;
/** Characters per window; ~3 chars/token keeps a window under MAX_TOKENS. */
const WINDOW_CHARS = 1200;
const WINDOW_OVERLAP = 150;

/** The parts of a Transformers.js tokenizer and model this module needs. */
export interface NerTokenizer {
  (text: string, options: { truncation: boolean; max_length: number }): { input_ids: { data: ArrayLike<bigint | number> } };
  decode(ids: number[], options: { skip_special_tokens: boolean }): string;
  all_special_ids: number[];
}

export interface NerModel {
  (inputs: unknown): Promise<{ logits: { data: ArrayLike<number>; dims: number[] } }>;
  config: { id2label: Record<string, string> };
}

function softmaxMax(row: ArrayLike<number>, offset: number, width: number): [number, number] {
  let maxIndex = 0;
  let maxLogit = -Infinity;
  for (let j = 0; j < width; j += 1) {
    const v = Number(row[offset + j]);
    if (v > maxLogit) {
      maxLogit = v;
      maxIndex = j;
    }
  }
  let sum = 0;
  for (let j = 0; j < width; j += 1) sum += Math.exp(Number(row[offset + j]) - maxLogit);
  return [maxIndex, 1 / sum];
}

async function runWindow(
  tokenizer: NerTokenizer,
  model: NerModel,
  text: string,
): Promise<EntitySpan[]> {
  const inputs = tokenizer(text, { truncation: true, max_length: MAX_TOKENS });
  const ids = Array.from(inputs.input_ids.data, Number);
  const { logits } = await model(inputs);
  const [, seqLen = 0, numLabels = 0] = logits.dims;
  const special = new Set(tokenizer.all_special_ids);

  const offsets = alignTokens(
    text,
    seqLen,
    (n) => tokenizer.decode(ids.slice(0, n), { skip_special_tokens: true }),
    (i) => special.has(ids[i] ?? -1),
  );

  const tokens: TokenPrediction[] = [];
  for (let i = 0; i < seqLen; i += 1) {
    const [labelIndex, score] = softmaxMax(logits.data, i * numLabels, numLabels);
    const span = offsets[i] ?? null;
    tokens.push({
      tag: model.config.id2label[String(labelIndex)] ?? 'O',
      score,
      start: span ? span[0] : null,
      end: span ? span[1] : null,
    });
  }
  return aggregateBio(toWords(tokens))
    .map((e) => {
      const [start, end] = trimSpan(text, e.start, e.end);
      return { ...e, start, end };
    })
    .filter((e) => e.end > e.start);
}

/**
 * Minimum model score for a detection to count. Measured on
 * tests/fixtures/ner-cases.json: private names scored ≥ 0.85, the one famous
 * name that was flagged ("Steve Jobs") scored 0.65.
 */
export const MIN_SCORE = 0.7;

/** Street words that often precede an Arabic address the model tags without them. */
const ADDRESS_PREFIX = /(?:شارع|طريق|حي|ش\.)\s+$/;
/** What may sit between two pieces of one address: commas, "رقم", "No.", "#". */
const ADDRESS_GAP = /^[\s,،]*(?:رقم|no\.?|#)?[\s,،]*$/i;

/**
 * Join an address the model split into pieces ("التحلية" … "45") and pull in a
 * street word right before it ("شارع"), so it is masked as one placeholder.
 */
export function joinAddressPieces(text: string, spans: readonly EntitySpan[]): EntitySpan[] {
  const result: EntitySpan[] = [];
  for (const span of spans) {
    let e = { ...span };
    if (e.type === 'STREET_ADDRESS') {
      const prefix = ADDRESS_PREFIX.exec(text.slice(Math.max(0, e.start - 12), e.start));
      if (prefix) e.start -= prefix[0].length;
      const last = result[result.length - 1];
      if (last?.type === 'STREET_ADDRESS' && ADDRESS_GAP.test(text.slice(last.end, e.start))) {
        e = { type: e.type, start: last.start, end: e.end, score: Math.min(last.score, e.score) };
        result.pop();
      }
    }
    result.push(e);
  }
  return result;
}

/** Entity spans for the whole prompt (windows merged, overlaps de-duplicated). */
export async function detectEntities(
  tokenizer: NerTokenizer,
  model: NerModel,
  text: string,
): Promise<EntitySpan[]> {
  if (!text.trim()) return [];
  if (text.length <= WINDOW_CHARS) return joinAddressPieces(text, await runWindow(tokenizer, model, text));

  const all: EntitySpan[] = [];
  for (let start = 0; start < text.length; start += WINDOW_CHARS - WINDOW_OVERLAP) {
    const chunk = text.slice(start, start + WINDOW_CHARS);
    for (const e of await runWindow(tokenizer, model, chunk)) {
      all.push({ ...e, start: e.start + start, end: e.end + start });
    }
    if (start + WINDOW_CHARS >= text.length) break;
  }
  // Keep one entity per overlapping region (the longer one).
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: EntitySpan[] = [];
  for (const e of all) {
    const last = result[result.length - 1];
    if (last && e.start < last.end) {
      if (e.end - e.start > last.end - last.start) result[result.length - 1] = e;
      continue;
    }
    result.push(e);
  }
  return joinAddressPieces(text, result);
}
