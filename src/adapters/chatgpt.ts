import { createAdapter } from './types';

/** ChatGPT (chatgpt.com): ProseMirror composer `#prompt-textarea`. */
export const chatgptAdapter = createAdapter({
  id: 'chatgpt',
  composer: [
    '#prompt-textarea[contenteditable="true"]',
    '#prompt-textarea',
    'form div.ProseMirror[contenteditable="true"]',
    'form textarea',
  ],
  sendButton: [
    'button[data-testid="send-button"]',
    '#composer-submit-button',
    'form button[aria-label*="Send" i]',
  ],
});
