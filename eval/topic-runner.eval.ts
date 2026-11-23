/**
 * Checks that the extension's own topic scoring (src/topics/runner.ts, batched,
 * used in the worker) gives the same scores as the library's zero-shot pipeline
 * that eval/topic.eval.ts measured. Node, CPU. Not part of `npm test`.
 * Run: npx vitest run -c vitest.eval.config.ts eval/topic-runner.eval.ts
 */

import { AutoModelForSequenceClassification, AutoTokenizer, pipeline } from '@huggingface/transformers';
import { expect, it } from 'vitest';
import { scoreTopics, TOPIC_MODEL, type TopicModel, type TopicTokenizer } from '../src/topics/runner';

const HYPOTHESES = [
  'This text discusses plans to lay off employees, cut jobs or restructure departments.',
  'This text discusses the salary, bonus or performance review of specific employees.',
  'This text discusses a planned merger, acquisition or sale of a company or business unit.',
];

const PROMPTS = [
  'We plan to cut 120 positions in operations in January. Draft the announcement for managers.',
  'We plan to cut 120 positions in January',
  'عمر راتبه 18 ألف ولينا راتبها 14 ألف لنفس الوظيفة، ساعدني أبرر الفرق.',
  'What is the capital of France?',
];

type Classifier = (text: string, labels: string[], options: { hypothesis_template: string; multi_label: boolean }) => Promise<{ labels: string[]; scores: number[] }>;

it('scores like the zero-shot pipeline', async () => {
  const options = { revision: TOPIC_MODEL.revision, dtype: TOPIC_MODEL.dtype };
  const classifier = (await pipeline('zero-shot-classification', TOPIC_MODEL.id, options)) as unknown as Classifier;
  const tokenizer = (await AutoTokenizer.from_pretrained(TOPIC_MODEL.id, { revision: TOPIC_MODEL.revision })) as unknown as TopicTokenizer;
  const model = (await AutoModelForSequenceClassification.from_pretrained(TOPIC_MODEL.id, options)) as unknown as TopicModel;

  const rows = [];
  for (const prompt of PROMPTS) {
    const reference = await classifier(prompt, HYPOTHESES, { hypothesis_template: '{}', multi_label: true });
    const expected = HYPOTHESES.map((h) => reference.scores[reference.labels.indexOf(h)] ?? 0);
    const started = performance.now();
    const actual = await scoreTopics(tokenizer, model, prompt, HYPOTHESES);
    rows.push({ prompt: prompt.slice(0, 40), expected: expected.map((n) => n.toFixed(3)).join(' '), actual: actual.map((n) => n.toFixed(3)).join(' '), ms: Math.round(performance.now() - started) });
    // One batched pass pads the inputs, which shifts an int8 model's scores slightly.
    actual.forEach((score, i) => expect(Math.abs(score - expected[i]!)).toBeLessThan(0.05));
  }
  console.table(rows);

  // A long text is read in pieces: a topic raised only at the end must still score high.
  const filler = 'The weather report says it will be sunny with light wind in the afternoon. '.repeat(60);
  const [layoffs] = await scoreTopics(tokenizer, model, `${filler}${PROMPTS[0]}`, HYPOTHESES);
  console.log(`long text (${filler.length + PROMPTS[0]!.length} chars), layoffs at the end: ${layoffs!.toFixed(3)}`);
  expect(layoffs).toBeGreaterThan(0.5);
});
