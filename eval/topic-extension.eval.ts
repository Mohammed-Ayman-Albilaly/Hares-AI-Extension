/**
 * TOPIC rules: the 80-prompt set scored by the extension's own code
 * (src/topics/runner.ts, the function the worker calls), to check that the
 * accuracy table measured with the library pipeline (eval/topic.eval.ts on the
 * branch experiment/topic-zeroshot-eval) holds for what the extension ships.
 * Node, CPU. Not part of `npm test`.
 * Run: npx vitest run -c vitest.eval.config.ts eval/topic-extension.eval.ts
 */

import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import data from '../docs/gp2-evidence/topic/topic-cases.json';
import { scoreTopics, TOPIC_MODEL, type TopicModel, type TopicTokenizer } from '../src/topics/runner';

const THRESHOLDS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const round = (n: number) => Math.round(n * 1000) / 1000;

it('scores the TOPIC set with the extension runner', async () => {
  const tokenizer = (await AutoTokenizer.from_pretrained(TOPIC_MODEL.id, { revision: TOPIC_MODEL.revision })) as unknown as TopicTokenizer;
  const model = (await AutoModelForSequenceClassification.from_pretrained(TOPIC_MODEL.id, {
    revision: TOPIC_MODEL.revision,
    dtype: TOPIC_MODEL.dtype,
  })) as unknown as TopicModel;
  const hypotheses = data.topics.map((t) => t.description.en);
  await scoreTopics(tokenizer, model, 'warm up', hypotheses);

  const rows: Array<{ id: string; lang: string; kind: string; gold: string[]; scores: Record<string, number> }> = [];
  const ms: number[] = [];
  for (const c of data.cases) {
    const started = performance.now();
    const scores = await scoreTopics(tokenizer, model, c.text, hypotheses);
    ms.push(performance.now() - started);
    rows.push({ id: c.id, lang: c.lang, kind: c.kind, gold: c.topics, scores: Object.fromEntries(data.topics.map((t, i) => [t.id, round(scores[i] ?? 0)])) });
  }

  const positives = rows.filter((r) => r.kind === 'positive');
  const sweep = THRESHOLDS.map((t) => {
    const caught = (set: typeof rows) => set.filter((r) => r.gold.some((g) => (r.scores[g] ?? 0) >= t)).length;
    const flagged = (kind: string) => rows.filter((r) => r.kind === kind && Object.values(r.scores).some((s) => s >= t));
    const ar = positives.filter((r) => r.lang === 'ar');
    const en = positives.filter((r) => r.lang === 'en');
    return {
      threshold: t,
      caught: `${caught(positives)}/${positives.length}`,
      recall: round(caught(positives) / positives.length),
      recallEn: round(caught(en) / en.length),
      recallAr: round(caught(ar) / ar.length),
      nearFlagged: `${flagged('near').length}/${rows.filter((r) => r.kind === 'near').length}`,
      ordinaryFlagged: `${flagged('negative').length}/${rows.filter((r) => r.kind === 'negative').length}`,
    };
  });
  const sorted = [...ms].sort((a, b) => a - b);
  console.table(sweep);
  writeFileSync(
    'docs/gp2-evidence/topic/topic-extension-runner.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model: TOPIC_MODEL,
        runtime: 'node (onnxruntime CPU), src/topics/runner.ts scoreTopics, all 8 topics in one batched pass',
        latencyMs: { p50: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), max: Math.round(sorted[sorted.length - 1] ?? 0) },
        sweep,
        rows,
      },
      null,
      2,
    ),
  );
});
