/**
 * Detection accuracy on the labelled set (GP2 evidence, E1). Node, CPU.
 * Not part of `npm test`.
 * Run: node eval/accuracy/build-dataset.mjs
 *      npx vitest run -c vitest.eval.config.ts eval/accuracy.eval.ts
 *
 * Runs every prompt of docs/gp2-evidence/accuracy/dataset.json through the same
 * code the extension uses (analyzePrompt, the built-in policy), in two
 * configurations: the rules alone, and the rules with the detection model.
 *
 * A "finding" here is a category in a prompt: a category the labels expect and
 * the extension reports is a true positive, an expected one it does not report
 * is a miss, and a reported one that is not expected is a false finding. Spans
 * are not compared.
 */

import { AutoModelForTokenClassification, AutoTokenizer } from '@huggingface/transformers';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaceholderVault } from '../src/masking/vault';
import { entitiesToDetections } from '../src/ner/mapping';
import { detectEntities, MIN_SCORE, NER_MODEL, type NerModel, type NerTokenizer } from '../src/ner/runner';
import { analyzePrompt } from '../src/pipeline/analyze';

const RISKS = ['SAFE', 'LOW', 'MEDIUM', 'HIGH'] as const;
type Risk = (typeof RISKS)[number];

interface Case {
  id: string;
  lang: string;
  kind: string;
  type: string;
  expectedCategories: string[];
  modelLabel?: string;
  expectedRisk: string;
  text: string;
}

interface Outcome {
  id: string;
  lang: string;
  kind: string;
  type: string;
  expected: string[];
  predicted: string[];
  /** category:label of every detection, for reading failures. */
  detail: string[];
  expectedRisk: string;
  predictedRisk: Risk;
  ms: number;
}

/** The full set is generated, not committed (see eval/accuracy/build-dataset.mjs). */
function loadDataset(): { cases: Case[] } {
  const path = 'docs/gp2-evidence/accuracy/dataset.json';
  if (!existsSync(path)) throw new Error(`${path} is missing: run "node eval/accuracy/build-dataset.mjs" first`);
  return JSON.parse(readFileSync(path, 'utf8')) as { cases: Case[] };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const prf = (tp: number, fp: number, fn: number) => {
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, precision: precision === null ? null : round(precision), recall: recall === null ? null : round(recall), f1: f1 === null ? null : round(f1) };
};

function summarise(outcomes: Outcome[]) {
  const categories = [...new Set(outcomes.flatMap((o) => [...o.expected, ...o.predicted]))].sort();
  const perCategory: Record<string, ReturnType<typeof prf>> = {};
  let TP = 0;
  let FP = 0;
  let FN = 0;
  for (const c of categories) {
    const tp = outcomes.filter((o) => o.expected.includes(c) && o.predicted.includes(c)).length;
    const fp = outcomes.filter((o) => !o.expected.includes(c) && o.predicted.includes(c)).length;
    const fn = outcomes.filter((o) => o.expected.includes(c) && !o.predicted.includes(c)).length;
    perCategory[c] = prf(tp, fp, fn);
    TP += tp;
    FP += fp;
    FN += fn;
  }
  const withF1 = Object.values(perCategory).filter((m) => m.f1 !== null);
  const confusion: Record<string, Record<string, number>> = {};
  for (const e of RISKS) confusion[e] = Object.fromEntries(RISKS.map((p) => [p, 0]));
  for (const o of outcomes) confusion[o.expectedRisk]![o.predictedRisk]! += 1;
  const clean = outcomes.filter((o) => o.kind === 'clean');
  const part = (set: Outcome[]) => ({ flagged: set.filter((o) => o.predicted.length > 0).length, warnedOrBlocked: set.filter((o) => o.predictedRisk === 'MEDIUM' || o.predictedRisk === 'HIGH').length, of: set.length });
  const sorted = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  return {
    prompts: outcomes.length,
    findings: { ...prf(TP, FP, FN), macroF1: round(withF1.reduce((sum, m) => sum + (m.f1 ?? 0), 0) / withF1.length) },
    riskAccuracy: round(outcomes.filter((o) => o.expectedRisk === o.predictedRisk).length / outcomes.length),
    /** Share of sensitive prompts whose risk came out lower than labelled: the dangerous direction. */
    underRated: outcomes.filter((o) => RISKS.indexOf(o.predictedRisk) < RISKS.indexOf(o.expectedRisk as Risk)).length,
    overRated: outcomes.filter((o) => RISKS.indexOf(o.predictedRisk) > RISKS.indexOf(o.expectedRisk as Risk)).length,
    confusion,
    cleanPrompts: {
      all: part(clean),
      ordinary: part(clean.filter((o) => o.type === 'ordinary')),
      hardNegatives: part(clean.filter((o) => o.type === 'hard-negative')),
      falsePositiveRate: round(clean.filter((o) => o.predicted.length > 0).length / clean.length),
      falseWarningRate: round(clean.filter((o) => o.predictedRisk === 'MEDIUM' || o.predictedRisk === 'HIGH').length / clean.length),
    },
    perCategory,
    latencyMs: { p50: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), max: Math.round(sorted[sorted.length - 1] ?? 0) },
  };
}

function report(name: string, outcomes: Outcome[], extra: Record<string, unknown>) {
  const byLanguage = Object.fromEntries(
    [...new Set(outcomes.map((o) => o.lang))].sort().map((lang) => {
      const s = summarise(outcomes.filter((o) => o.lang === lang));
      return [lang, { prompts: s.prompts, findings: s.findings, riskAccuracy: s.riskAccuracy, cleanPrompts: s.cleanPrompts.all }];
    }),
  );
  const failures = outcomes
    .filter((o) => o.expectedRisk !== o.predictedRisk || o.expected.join() !== o.predicted.join())
    .map((o) => ({ id: o.id, type: o.type, lang: o.lang, expected: o.expected, predicted: o.predicted, detail: o.detail, expectedRisk: o.expectedRisk, predictedRisk: o.predictedRisk }));
  const overall = summarise(outcomes);
  writeFileSync(
    `docs/gp2-evidence/accuracy/results-${name}.json`,
    JSON.stringify({ date: new Date().toISOString(), configuration: name, ...extra, overall, byLanguage, failures, outcomes }, null, 2),
  );
  console.log(`\n${name}: finding P ${overall.findings.precision} R ${overall.findings.recall} F1 ${overall.findings.f1}; risk accuracy ${overall.riskAccuracy}; clean prompts flagged ${overall.cleanPrompts.all.flagged}/${overall.cleanPrompts.all.of}`);
}

it('measures detection accuracy on the labelled set', async () => {
  const { cases } = loadDataset();

  // 1. Rules only.
  const rules: Outcome[] = cases.map((c) => {
    const started = performance.now();
    const a = analyzePrompt(c.text, new PlaceholderVault());
    return {
      id: c.id, lang: c.lang, kind: c.kind, type: c.type,
      expected: c.expectedCategories,
      predicted: [...new Set(a.detections.map((d) => d.category as string))].sort(),
      detail: [...new Set(a.detections.map((d) => `${d.category}:${d.label}`))].sort(),
      expectedRisk: c.expectedRisk,
      predictedRisk: a.decision.tier,
      ms: performance.now() - started,
    };
  });
  report('rules-only', rules, { model: null });

  // 2. Rules + detection model.
  const tokenizer = (await AutoTokenizer.from_pretrained(NER_MODEL.id, { revision: NER_MODEL.revision })) as unknown as NerTokenizer;
  const model = (await AutoModelForTokenClassification.from_pretrained(NER_MODEL.id, { revision: NER_MODEL.revision, dtype: NER_MODEL.dtype })) as unknown as NerModel;
  await detectEntities(tokenizer, model, 'warm up');
  const withModel: Outcome[] = [];
  for (const c of cases) {
    const started = performance.now();
    const entities = await detectEntities(tokenizer, model, c.text);
    const a = analyzePrompt(c.text, new PlaceholderVault(), { modelDetections: entitiesToDetections(c.text, entities) });
    withModel.push({
      id: c.id, lang: c.lang, kind: c.kind, type: c.type,
      expected: c.expectedCategories,
      predicted: [...new Set(a.detections.map((d) => d.category as string))].sort(),
      detail: [...new Set(a.detections.map((d) => `${d.category}:${d.label}(${d.source})`))].sort(),
      expectedRisk: c.expectedRisk,
      predictedRisk: a.decision.tier,
      ms: performance.now() - started,
    });
  }
  report('rules-and-model', withModel, { model: { ...NER_MODEL, minScore: MIN_SCORE } });
});
