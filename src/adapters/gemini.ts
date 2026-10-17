import { createAdapter } from './types';

/** Gemini (gemini.google.com): Quill editor inside the `rich-textarea` element. */
export const geminiAdapter = createAdapter({
  id: 'gemini',
  composer: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
  ],
  sendButton: [
    'button.send-button',
    '.send-button-container button',
    'button[aria-label*="Send message" i]',
    'button[aria-label*="إرسال"]',
  ],
});
