/**
 * Hares AI — Gemini content script: installs the shared send interceptor with
 * the Gemini adapter (see entrypoints/chatgpt.content.ts).
 */

import { geminiAdapter } from '../src/adapters/gemini';
import { installInterceptor } from '../src/interceptor/interceptor';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  // document_start: our capture listeners must be registered before the
  // site's own, or a site that handles Enter on `window` sends first.
  runAt: 'document_start',
  main() {
    installInterceptor(geminiAdapter);
  },
});
