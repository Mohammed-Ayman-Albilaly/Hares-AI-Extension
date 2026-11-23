/**
 * Hares AI — score a message against TOPIC descriptions with the decision model.
 *
 * The model is a natural-language-inference classifier: given the message and
 * one sentence ("This text discusses plans to lay off employees"), it says how
 * strongly the message supports the sentence. Each topic is judged on its own,
 * so a message may match several topics or none.
 *
 * Kept free of the model library's types so the same code runs in the worker
 * and in the Node evaluation (eval/topic.eval.ts measured this scoring rule).
 */

/** Pinned decision model: see src/model/config.ts. */
export { MODEL as TOPIC_MODEL } from '../model/config';

export interface TopicTokenizer {
  (texts: string[], options: { text_pair: string[]; padding: boolean; truncation: boolean }): unknown;
}

export interface TopicModel {
  (inputs: unknown): Promise<{ logits: { data: ArrayLike<number>; dims: number[] } }>;
  config?: { label2id?: Record<string, number> };
}

/** The model reads at most 512 tokens; a longer message is read in overlapping pieces. */
export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 200;
/** Bounds the work on a pasted document: the first pieces and the last one are read. */
export const MAX_CHUNKS = 6;

/**
 * Cut a long message into overlapping pieces, breaking at whitespace where
 * possible. A message that fits is returned whole.
 */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP, maxChunks = MAX_CHUNKS): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= size) return trimmed.length > 0 ? [trimmed] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(trimmed.length, start + size);
    if (end < trimmed.length) {
      // Prefer to cut at the last whitespace in the final fifth of the piece.
      const space = trimmed.lastIndexOf(' ', end);
      if (space > start + size * 0.8) end = space;
    }
    chunks.push(trimmed.slice(start, end).trim());
    if (end >= trimmed.length) break;
    start = end - overlap;
  }
  if (chunks.length <= maxChunks) return chunks;
  return [...chunks.slice(0, maxChunks - 1), chunks[chunks.length - 1]!];
}

/**
 * Which outputs of the model mean "supports the sentence" and "does not".
 * Same rule as the library's zero-shot pipeline, so scores match the evaluation.
 */
export function entailmentIds(label2id: Record<string, number> | undefined): { entailment: number; contradiction: number } {
  return {
    entailment: label2id?.entailment ?? 2,
    contradiction: label2id?.contradiction ?? label2id?.not_entailment ?? 0,
  };
}

/** Probability of "supports" against "does not", from the two logits. */
export function entailmentProbability(contradiction: number, entailment: number): number {
  return 1 / (1 + Math.exp(contradiction - entailment));
}

/**
 * Score `text` against every hypothesis: one number from 0 to 1 per hypothesis,
 * in the same order. A long text is scored piece by piece and the highest score
 * of each hypothesis is kept, so a topic raised anywhere in the text counts.
 */
export async function scoreTopics(
  tokenizer: TopicTokenizer,
  model: TopicModel,
  text: string,
  hypotheses: readonly string[],
): Promise<number[]> {
  const scores = hypotheses.map(() => 0);
  if (hypotheses.length === 0) return scores;
  const { entailment, contradiction } = entailmentIds(model.config?.label2id);

  for (const chunk of chunkText(text)) {
    // All hypotheses for this piece in one forward pass.
    const inputs = tokenizer(
      hypotheses.map(() => chunk),
      { text_pair: [...hypotheses], padding: true, truncation: true },
    );
    const { logits } = await model(inputs);
    const width = logits.dims[1] ?? 0;
    for (let i = 0; i < hypotheses.length; i += 1) {
      const p = entailmentProbability(Number(logits.data[i * width + contradiction]), Number(logits.data[i * width + entailment]));
      if (p > scores[i]!) scores[i] = p;
    }
  }
  return scores;
}
