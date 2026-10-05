// Generates docs/testing/manual-tests.md from tests/fixtures/*.json, so the
// manual checklist for ChatGPT never drifts from the automated scenarios.
// Usage: node scripts/gen-manual-tests.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../tests/fixtures/${p}`, import.meta.url), 'utf8'));
const en = load('prompts-en.json').cases;
const ar = load('prompts-ar.json').cases;
const convs = load('conversations.json').conversations;

const cell = (s) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const expectText = (c) => (c.labels?.length ? `${c.tier} — ${c.labels.map((l) => `[${l}_n]`).join(', ')}` : c.tier);

function table(cases) {
  const rows = cases.map((c) => {
    const status = c.gap ? `⚠️ Known gap: ${c.gap}` : '';
    return `| ${c.id} | ${cell(c.text)} | ${expectText(c)} | ${status} | ☐ |`;
  });
  return ['| ID | Type this | Expected | Note | Pass |', '|---|---|---|---|---|', ...rows].join('\n');
}

function conversation(conv) {
  const steps = conv.turns.map((t, i) => {
    const text = t.text === '$REVISED_PREVIOUS' ? '(paste the revised text from the previous step)' : t.text;
    const expected = t.tier ?? `at most ${t.maxTier}`;
    const extra = [
      t.labels?.length ? `placeholders: ${t.labels.join(', ')}` : '',
      t.crosses ? 'shows "↩ continues previous message"' : '',
      t.revised ? `revised = \`${t.revised}\`` : '',
      t.send === 'revised' ? 'then choose **Send revised**' : '',
    ].filter(Boolean).join('; ');
    return `${i + 1}. \`${cell(text)}\` → **${expected}**${extra ? ` (${extra})` : ''}`;
  });
  return `### ${conv.id} — ${conv.title}\n\nStart a **new chat**, then send in order:\n\n${steps.join('\n')}\n\n☐ Pass`;
}

const doc = `# Hares AI — manual test checklist (ChatGPT)

Generated from \`tests/fixtures/\` by \`node scripts/gen-manual-tests.mjs\` — edit the JSON, not this file.
All values are synthetic. Never test with real data.

**How to read "Expected":**
SAFE = sends, nothing shown · LOW = sends + small toast · MEDIUM = dialog (Confirm / Send revised / Edit) · HIGH = dialog without Confirm.
For MEDIUM/HIGH also check that **Send revised** puts the placeholder version into ChatGPT and that ChatGPT receives it.

## English — single messages

${table(en)}

## Arabic — single messages

${table(ar)}

## Conversations

${convs.map(conversation).join('\n\n')}
`;

mkdirSync(new URL('../docs/testing/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/testing/manual-tests.md', import.meta.url), doc);
console.log('wrote docs/testing/manual-tests.md');
