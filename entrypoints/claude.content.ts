/**
 * Hares AI — Claude content script: installs the shared send interceptor with
 * the Claude adapter (see entrypoints/chatgpt.content.ts).
 */

import { claudeAdapter } from '../src/adapters/claude';
import { installInterceptor } from '../src/interceptor/interceptor';

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  // document_start: our capture listeners must be registered before the
  // site's own, or a site that handles Enter on `window` sends first.
  runAt: 'document_start',
  main() {
    installInterceptor(claudeAdapter);
  },
});
