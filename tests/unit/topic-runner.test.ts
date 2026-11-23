import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ sendMessage: (async (): Promise<unknown> => undefined) as (...args: unknown[]) => Promise<unknown> }));
vi.mock('wxt/browser', () => ({ browser: { runtime } }));

import { MSG, TARGET } from '../../src/messaging/protocol';
import { requestTopicScores } from '../../src/topics/client';
import {
  CHUNK_CHARS,
  MAX_CHUNKS,
  chunkText,
  entailmentIds,
  entailmentProbability,
  scoreTopics,
  type TopicModel,
  type TopicTokenizer,
} from '../../src/topics/runner';

afterEach(() => vi.useRealTimers());

describe('chunkText', () => {
  it('returns a short message whole, and nothing for an empty one', () => {
    expect(chunkText('  hello there  ')).toEqual(['hello there']);
    expect(chunkText('   ')).toEqual([]);
  });

  it('cuts a long message into overlapping pieces that cover all of it', () => {
    const words = Array.from({ length: 700 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(chunks[0]!.startsWith('word0 ')).toBe(true);
    expect(chunks[chunks.length - 1]!.endsWith('word699')).toBe(true);
    // Every word is in at least one piece, whole.
    for (const w of words) expect(chunks.some((c) => c.split(' ').includes(w)), w).toBe(true);
  });

  it('reads at most 6 pieces of a very long text: the first five and the last', () => {
    const text = Array.from({ length: 6000 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(MAX_CHUNKS);
    expect(chunks[0]!.startsWith('w0 ')).toBe(true);
    expect(chunks[MAX_CHUNKS - 1]!.endsWith('w5999')).toBe(true);
  });

  it('still cuts a text without spaces', () => {
    const chunks = chunkText('x'.repeat(3000));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
  });
});

describe('reading the model output', () => {
  it('finds the labels of a two-label and of a three-label model', () => {
    expect(entailmentIds({ not_entailment: 0, entailment: 1 })).toEqual({ entailment: 1, contradiction: 0 });
    expect(entailmentIds({ entailment: 0, neutral: 1, contradiction: 2 })).toEqual({ entailment: 0, contradiction: 2 });
    expect(entailmentIds(undefined)).toEqual({ entailment: 2, contradiction: 0 });
  });

  it('turns two logits into a probability', () => {
    expect(entailmentProbability(0, 0)).toBeCloseTo(0.5);
    expect(entailmentProbability(-3, 3)).toBeGreaterThan(0.99);
    expect(entailmentProbability(3, -3)).toBeLessThan(0.01);
  });
});

/** A fake model: a (text, hypothesis) pair "entails" when the text contains the hypothesis's keyword. */
function fakeModel() {
  const calls: Array<{ texts: string[]; pairs: string[] }> = [];
  const tokenizer: TopicTokenizer = (texts, options) => {
    calls.push({ texts, pairs: options.text_pair });
    return { texts, pairs: options.text_pair };
  };
  const model = (async (inputs: unknown) => {
    const { texts, pairs } = inputs as { texts: string[]; pairs: string[] };
    const data: number[] = [];
    texts.forEach((text, i) => {
      const hit = text.includes(pairs[i]!.split(':')[1]!);
      data.push(hit ? -4 : 4, hit ? 4 : -4); // [not_entailment, entailment]
    });
    return { logits: { data, dims: [texts.length, 2] } };
  }) as TopicModel;
  model.config = { label2id: { not_entailment: 0, entailment: 1 } };
  return { tokenizer, model, calls };
}

describe('scoreTopics', () => {
  it('scores every hypothesis on its own, in order, in one pass', async () => {
    const { tokenizer, model, calls } = fakeModel();
    const scores = await scoreTopics(tokenizer, model, 'we discuss layoffs today', ['about:layoffs', 'about:salaries', 'about:discuss']);
    expect(scores[0]).toBeGreaterThan(0.99);
    expect(scores[1]).toBeLessThan(0.01);
    expect(scores[2]).toBeGreaterThan(0.99);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.pairs).toEqual(['about:layoffs', 'about:salaries', 'about:discuss']);
  });

  it('a message may match no topic', async () => {
    const { tokenizer, model } = fakeModel();
    const scores = await scoreTopics(tokenizer, model, 'what is the capital of France', ['about:layoffs', 'about:salaries']);
    expect(Math.max(...scores)).toBeLessThan(0.01);
  });

  it('catches a topic that appears only at the end of a long text', async () => {
    const { tokenizer, model, calls } = fakeModel();
    const text = `${'filler words here '.repeat(300)}and finally the layoffs`;
    const scores = await scoreTopics(tokenizer, model, text, ['about:layoffs', 'about:salaries']);
    expect(calls.length).toBeGreaterThan(1);
    expect(scores[0]).toBeGreaterThan(0.99);
    expect(scores[1]).toBeLessThan(0.01);
  });

  it('does nothing without hypotheses or without text', async () => {
    const { tokenizer, model, calls } = fakeModel();
    expect(await scoreTopics(tokenizer, model, 'anything', [])).toEqual([]);
    expect(await scoreTopics(tokenizer, model, '   ', ['about:x'])).toEqual([0]);
    expect(calls).toHaveLength(0);
  });
});

describe('requestTopicScores', () => {
  it('asks the background and returns the scores', async () => {
    const send = vi.fn(async () => ({ ok: true, status: 'ready', scores: [0.8, 0.1], latencyMs: 200 }));
    runtime.sendMessage = send;
    const result = await requestTopicScores('some text', ['h1', 'h2']);
    expect(result).toEqual({ outcome: 'ready', scores: [0.8, 0.1], latencyMs: 200 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ target: TARGET.BACKGROUND, type: MSG.TOPICS, text: 'some text', hypotheses: ['h1', 'h2'] }));
  });

  it('gives no scores while the model is still loading', async () => {
    runtime.sendMessage = vi.fn(async () => ({ ok: false, status: 'loading' }));
    expect(await requestTopicScores('t', ['h'])).toMatchObject({ outcome: 'loading', scores: [] });
  });

  it('never throws: an unreachable background is an error outcome', async () => {
    runtime.sendMessage = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    expect(await requestTopicScores('t', ['h'])).toEqual({ outcome: 'error', scores: [] });
    runtime.sendMessage = vi.fn(async () => undefined);
    expect(await requestTopicScores('t', ['h'])).toEqual({ outcome: 'error', scores: [] });
  });

  it('refuses a reply whose scores do not line up with the request', async () => {
    runtime.sendMessage = vi.fn(async () => ({ ok: true, status: 'ready', scores: [0.9] }));
    expect(await requestTopicScores('t', ['h1', 'h2'])).toEqual({ outcome: 'error', scores: [] });
  });

  it('does not hold the send past the timeout', async () => {
    vi.useFakeTimers();
    runtime.sendMessage = vi.fn(() => new Promise<unknown>(() => undefined));
    let result: unknown;
    void requestTopicScores('t', ['h'], 4000).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(3999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(result).toEqual({ outcome: 'timeout', scores: [] });
  });
});
