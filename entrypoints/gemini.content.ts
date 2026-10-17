/**
 * Hares AI — Gemini content script: installs the shared send interceptor with
 * the Gemini adapter (see entrypoints/chatgpt.content.ts).
 */

import { geminiAdapter } from '../src/adapters/gemini';
import { installInterceptor } from '../src/interceptor/interceptor';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
    installInterceptor(geminiAdapter);
  },
});
