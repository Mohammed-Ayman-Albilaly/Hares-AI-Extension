/**
 * Hares AI — Phase 1 Gemini content script.
 *
 * Phase 1 scope: prove the script loads on the Gemini origin and that the
 * content -> background -> offscreen -> worker round-trip works. No prompt
 * analysis, no interception, no UI.
 */

import {
  MSG,
  TARGET,
  type ProbeMessage,
  type ProbeResponse,
} from '../src/messaging/protocol';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
    console.info('[hares] content script loaded on Gemini');
    void runProbe('gemini');
  },
});

async function runProbe(platform: string): Promise<void> {
  const message: ProbeMessage = {
    target: TARGET.BACKGROUND,
    type: MSG.PROBE,
    id: crypto.randomUUID(),
    platform,
  };

  try {
    const response = (await browser.runtime.sendMessage(
      message,
    )) as ProbeResponse;
    console.info(`[hares] probe round-trip (${platform}) completed:`, response);
    document.dispatchEvent(
      new CustomEvent('hares:probe', { detail: response }),
    );
  } catch (error) {
    console.error(`[hares] probe round-trip (${platform}) failed:`, error);
  }
}
