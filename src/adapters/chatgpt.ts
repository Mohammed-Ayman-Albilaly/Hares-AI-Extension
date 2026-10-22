import { createAdapter } from './types';

/**
 * ChatGPT (chatgpt.com). Selectors for both layouts:
 *  - 2026-10 redesign: plain <textarea id="mobile-composer-prompt"> and a
 *    "Send message" submit button with generated class names;
 *  - earlier: ProseMirror composer #prompt-textarea + data-testid="send-button".
 */
export const chatgptAdapter = createAdapter({
  id: 'chatgpt',
  composer: [
    '#prompt-textarea[contenteditable="true"]',
    '#prompt-textarea',
    '#mobile-composer-prompt',
    'textarea[aria-label*="ChatGPT" i]',
    'form div.ProseMirror[contenteditable="true"]',
    'form textarea',
  ],
  sendButton: [
    'button[data-testid="send-button"]',
    '#composer-submit-button',
    'button[aria-label="Send message" i]',
    'button[type="submit"][aria-label*="Send" i]',
    'button[aria-label*="Send" i]',
  ],
});
