/**
 * Analysis time by prompt size, in Node on the CPU (GP2 evidence, E2).
 * This is NOT the browser: it measures the extension's own code and the model
 * with the Node ONNX runtime. Browser numbers are in docs/gp2-evidence.
 * Not part of `npm test`.
 * Run: npx vitest run -c vitest.eval.config.ts eval/perf.eval.ts
 */

import { AutoModelForTokenClassification, AutoTokenizer } from '@huggingface/transformers';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaceholderVault } from '../src/masking/vault';
import { entitiesToDetections } from '../src/ner/mapping';
import { detectEntities, NER_MODEL, type NerModel, type NerTokenizer } from '../src/ner/runner';
import { analyzePrompt } from '../src/pipeline/analyze';

const SIZES = [100, 1000, 5000];
const RUNS = 50;
/** The extension stops waiting for the detection model after this long. */
const LIMIT_MS = 2500;

/** The full set is generated, not committed (see eval/accuracy/build-dataset.mjs). */
function loadTexts(): string[] {
  const path = 'docs/gp2-evidence/accuracy/dataset.json';
  if (!existsSync(path)) throw new Error(`${path} is missing: run "node eval/accuracy/build-dataset.mjs" first`);
  const data = JSON.parse(readFileSync(path, 'utf8')) as { cases: Array<{ text: string }> };
  return data.cases.map((c) => c.text.replace(/\n/g, ' '));
}

/** A prompt of about `size` characters made of real test sentences, half of them with sensitive values. */
function promptOf(texts: string[], size: number, offset: number): string {
  let out = '';
  for (let i = offset; out.length < size; i += 7) out += `${texts[i % texts.length]} `;
  return out.slice(0, size);
}

function stats(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { runs: ms.length, median: r(at(0.5)), p95: r(at(0.95)), max: r(sorted[sorted.length - 1] ?? 0) };
}

it('times the analysis by prompt size', async () => {
  const tokenizer = (await AutoTokenizer.from_pretrained(NER_MODEL.id, { revision: NER_MODEL.revision })) as unknown as NerTokenizer;
  const model = (await AutoModelForTokenClassification.from_pretrained(NER_MODEL.id, { revision: NER_MODEL.revision, dtype: NER_MODEL.dtype })) as unknown as NerModel;
  await detectEntities(tokenizer, model, 'warm up');

  const texts = loadTexts();
  const result: Record<string, unknown> = {};
  for (const size of SIZES) {
    const rulesOnly: number[] = [];
    const full: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const text = promptOf(texts, size, run * 3);
      let t = performance.now();
      analyzePrompt(text, new PlaceholderVault());
      rulesOnly.push(performance.now() - t);
      t = performance.now();
      const entities = await detectEntities(tokenizer, model, text);
      analyzePrompt(text, new PlaceholderVault(), { modelDetections: entitiesToDetections(text, entities) });
      full.push(performance.now() - t);
    }
    result[`${size} characters`] = {
      rulesOnlyMs: stats(rulesOnly),
      rulesAndModelMs: { ...stats(full), overLimit: full.filter((ms) => ms > LIMIT_MS).length },
    };
  }
  console.log(JSON.stringify(result, null, 2));
  mkdirSync('docs/gp2-evidence/performance', { recursive: true });
  writeFileSync(
    'docs/gp2-evidence/performance/node-timing.json',
    JSON.stringify({ date: new Date().toISOString(), runtime: `node ${process.version}, onnxruntime CPU, warm model`, limitMs: LIMIT_MS, runsPerSize: RUNS, result }, null, 2),
  );
});
