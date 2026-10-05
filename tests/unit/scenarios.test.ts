/**
 * Scenario tests driven by tests/fixtures/*.json (English, Arabic, and
 * multi-turn conversations). Cases marked `gap` are known limitations: they
 * are skipped and listed, so the gap stays visible without failing the suite.
 */

import { describe, expect, it } from 'vitest';
import { TIER_RANK, type Tier } from '../../src/detectors/categories';
import { PlaceholderVault } from '../../src/masking/vault';
import { analyzePrompt, type AnalysisResult } from '../../src/pipeline/analyze';
import { ConversationState } from '../../src/pipeline/conversation';
import conversations from '../fixtures/conversations.json';
import promptsAr from '../fixtures/prompts-ar.json';
import promptsEn from '../fixtures/prompts-en.json';

interface PromptCase {
  id: string;
  text: string;
  tier: string;
  labels: string[];
  gap?: string;
}

interface Turn {
  text: string;
  tier?: string;
  maxTier?: string;
  labels?: string[];
  crosses?: boolean;
  revised?: string;
  send?: 'original' | 'revised';
}

/** Placeholder labels in a result: `[EMAIL_1]` → `EMAIL`. */
function labelsOf(analysis: AnalysisResult): string[] {
  return analysis.findings
    .map((f) => f.placeholder?.slice(1, -1).replace(/_\d+$/, ''))
    .filter((l): l is string => !!l);
}

function expectNoRawValues(analysis: AnalysisResult): void {
  for (const d of analysis.detections) {
    if (d.category === 'KEYWORD') continue;
    expect(analysis.revised, `raw value "${d.value}" left in revised text`).not.toContain(d.value);
  }
}

function runPromptCases(name: string, cases: PromptCase[]): void {
  describe(name, () => {
    for (const c of cases) {
      const title = `${c.id}: ${c.text.replace(/\n/g, ' ').slice(0, 60)}`;
      if (c.gap) {
        it.skip(`[known gap] ${title} — ${c.gap}`, () => {});
        continue;
      }
      it(title, () => {
        const analysis = analyzePrompt(c.text, new PlaceholderVault());
        expect(analysis.decision.tier).toBe(c.tier);
        expect(labelsOf(analysis)).toEqual(expect.arrayContaining(c.labels));
        expectNoRawValues(analysis);
      });
    }
  });
}

runPromptCases('English prompts', promptsEn.cases);
runPromptCases('Arabic prompts', promptsAr.cases);

describe('Conversations', () => {
  for (const conv of conversations.conversations) {
    it(`${conv.id}: ${conv.title}`, () => {
      const state = new ConversationState();
      let previousRevised = '';
      conv.turns.forEach((raw, index) => {
        const turn = raw as Turn;
        const text = turn.text === '$REVISED_PREVIOUS' ? previousRevised : turn.text;
        const analysis = analyzePrompt(text, state.vault, { historyTail: state.historyTail() });
        const where = `${conv.id} turn ${index + 1}`;

        if (turn.tier) expect(analysis.decision.tier, where).toBe(turn.tier);
        if (turn.maxTier) {
          expect(TIER_RANK[analysis.decision.tier], where).toBeLessThanOrEqual(TIER_RANK[turn.maxTier as Tier]);
        }
        if (turn.labels) expect(labelsOf(analysis), where).toEqual(expect.arrayContaining(turn.labels));
        if (turn.crosses !== undefined) {
          expect(analysis.findings.some((f) => f.crossesMessages), where).toBe(turn.crosses);
        }
        if (turn.revised !== undefined) expect(analysis.revised, where).toBe(turn.revised);
        expectNoRawValues(analysis);

        // What the user sends next: HIGH can only send the revised version.
        const send = turn.send ?? (analysis.decision.tier === 'HIGH' ? 'revised' : 'original');
        state.lastSent = send === 'revised' ? analysis.revised : text;
        previousRevised = analysis.revised;
      });
    });
  }
});
