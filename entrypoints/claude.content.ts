/**
 * Hares AI — Claude content script: installs the shared send interceptor with
 * the Claude adapter (see entrypoints/chatgpt.content.ts).
 */

import { claudeAdapter } from '../src/adapters/claude';
import { installInterceptor } from '../src/interceptor/interceptor';

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  runAt: 'document_idle',
  main() {
    installInterceptor(claudeAdapter);
  },
});
