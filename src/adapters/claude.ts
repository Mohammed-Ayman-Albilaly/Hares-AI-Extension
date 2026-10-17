import { createAdapter } from './types';

/** Claude (claude.ai): ProseMirror/Tiptap composer inside the chat input fieldset. */
export const claudeAdapter = createAdapter({
  id: 'claude',
  composer: [
    '[data-testid="chat-input"] [contenteditable="true"]',
    '[data-testid="chat-input"][contenteditable="true"]',
    'fieldset div.ProseMirror[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
  ],
  sendButton: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message" i]',
    'button[aria-label*="Send" i]',
  ],
});
