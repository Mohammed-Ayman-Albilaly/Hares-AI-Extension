import { closestAny, queryFirst, type PlatformAdapter } from './types';

const COMPOSER = [
  '#prompt-textarea[contenteditable="true"]',
  '#prompt-textarea',
  'form div.ProseMirror[contenteditable="true"]',
  'form textarea',
] as const;

const SEND_BUTTON = [
  'button[data-testid="send-button"]',
  '#composer-submit-button',
  'form button[aria-label*="Send" i]',
] as const;

export const chatgptAdapter: PlatformAdapter = {
  id: 'chatgpt',
  getComposer: () => queryFirst(COMPOSER),
  getSendButton: () => queryFirst(SEND_BUTTON),
  isSendButton: (target) => closestAny(target, SEND_BUTTON) !== null,
};
