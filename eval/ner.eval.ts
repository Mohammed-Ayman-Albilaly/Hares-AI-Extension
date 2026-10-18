/**
 * Detection-model evaluation (Node, CPU). Not part of `npm test`.
 * Run: npx vitest run -c vitest.eval.config.ts
 *
 * Loads the pinned model, runs every case in tests/fixtures/ner-cases.json
 * through the same code the extension uses (src/ner/runner.ts), and prints:
 * recall per language, false positives on normal prompts, flags on famous
 * names, and latency. Writes the full report to eval/results/ner-<date>.json.
 */

import { AutoModelForTokenClassification, AutoTokenizer } from '@huggingface/transformers';
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { enabledModelLabels } from '../src/ner/labels';
import { detectEntities, MIN_SCORE, NER_MODEL, type NerModel, type NerTokenizer } from '../src/ner/runner';
import cases from '../tests/fixtures/ner-cases.json';


interface Expected { type: string; value: string }

it('evaluates the detection model', async () => {
  const loadStart = performance.now();
  const tokenizer = (await AutoTokenizer.from_pretrained(NER_MODEL.id, { revision: NER_MODEL.revision })) as unknown as NerTokenizer;
  const model = (await AutoModelForTokenClassification.from_pretrained(NER_MODEL.id, {
    revision: NER_MODEL.revision,
    dtype: NER_MODEL.dtype,
  })) as unknown as NerModel;
  const loadMs = Math.round(performance.now() - loadStart);
  const enabled = enabledModelLabels();

  // Warm-up (first call compiles kernels).
  await detectEntities(tokenizer, model, 'warm up');

  const rows = [];
  const stats: Record<string, { expected: number; found: number; predicted: number; falsePositive: number; negatives: number; negativesFlagged: number; publics: number; publicsFlagged: number; ms: number[] }> = {};

  for (const c of cases.cases) {
    const s = (stats[c.lang] ??= { expected: 0, found: 0, predicted: 0, falsePositive: 0, negatives: 0, negativesFlagged: 0, publics: 0, publicsFlagged: 0, ms: [] });
    const t0 = performance.now();
    const all = await detectEntities(tokenizer, model, c.text);
    s.ms.push(performance.now() - t0);
    const predicted = all.filter((e) => e.score >= MIN_SCORE && enabled.has(e.type));

    const expectedSpans = (c.entities as Expected[]).map((e) => {
      const start = c.text.indexOf(e.value);
      return { ...e, start, end: start + e.value.length };
    });
    const hit = (e: { start: number; end: number }, x: { start: number; end: number }) => e.start < x.end && x.start < e.end;

    let found = 0;
    for (const x of expectedSpans) if (predicted.some((p) => p.type === x.type && hit(p, x))) found += 1;
    const falsePositive = predicted.filter((p) => !expectedSpans.some((x) => hit(p, x))).length;

    s.expected += expectedSpans.length;
    s.found += found;
    s.predicted += predicted.length;
    s.falsePositive += falsePositive;
    if (c.kind === 'negative') { s.negatives += 1; if (predicted.length) s.negativesFlagged += 1; }
    if (c.kind === 'public') { s.publics += 1; if (predicted.length) s.publicsFlagged += 1; }

    rows.push({
      id: c.id,
      kind: c.kind,
      expected: expectedSpans.map((x) => `${x.type}:${x.value}`).join(' | '),
      predicted: all.map((p) => `${p.type}:${c.text.slice(p.start, p.end)}(${p.score.toFixed(2)})${enabled.has(p.type) && p.score >= MIN_SCORE ? '' : '[off]'}`).join(' | '),
      ok: found === expectedSpans.length && falsePositive === 0 ? '✓' : '✗',
    });
  }

  console.table(rows);
  const summary = Object.fromEntries(
    Object.entries(stats).map(([lang, s]) => {
      const sorted = [...s.ms].sort((a, b) => a - b);
      return [lang, {
        recall: s.expected ? +(s.found / s.expected).toFixed(2) : null,
        precision: s.predicted ? +((s.predicted - s.falsePositive) / s.predicted).toFixed(2) : null,
        normalPromptsFlagged: `${s.negativesFlagged}/${s.negatives}`,
        famousNamesFlagged: `${s.publicsFlagged}/${s.publics}`,
        p50ms: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
        maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      }];
    }),
  );
  console.table(summary);
  console.log(`model load: ${loadMs} ms (includes download on first run)`);

  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    new URL(`./results/ner-${date}.json`, import.meta.url),
    JSON.stringify({ model: NER_MODEL, minScore: MIN_SCORE, runtime: 'node-cpu', loadMs, summary, rows }, null, 2),
  );
}, 30 * 60_000);
