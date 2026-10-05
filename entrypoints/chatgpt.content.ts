/**
 * Hares AI — ChatGPT content script.
 *
 * Installs the shared send interceptor with the ChatGPT adapter. Phase 1 runs
 * the rule detectors locally in this script (no model), so analysis is
 * instant; model stages are added later through the background/offscreen path.
 */

import { chatgptAdapter } from '../src/adapters/chatgpt';
import { installInterceptor } from '../src/interceptor/interceptor';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',
  main() {
    installInterceptor(chatgptAdapter);
  },
});
