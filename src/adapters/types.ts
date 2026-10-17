/**
 * Hares AI — per-platform adapter contract.
 *
 * Everything that depends on a site's DOM lives behind this interface, so the
 * interceptor and UI are shared across ChatGPT, Claude and Gemini. Sites change
 * their markup often, so each adapter tries its known selectors first and then
 * falls back to a generic search (an editable textbox, and a "Send" button near
 * it — in English or Arabic UI).
 */

export interface PlatformAdapter {
  id: 'chatgpt' | 'claude' | 'gemini';
  /** The editable element the user types into, or null if not on the page. */
  getComposer(): HTMLElement | null;
  /** The send button, or null if not rendered. */
  getSendButton(): HTMLElement | null;
  /** Does this event target belong to the send button? */
  isSendButton(target: EventTarget | null): boolean;
}

/** First element matching any selector, in order. */
export function queryFirst<T extends Element = HTMLElement>(
  selectors: readonly string[],
  root: ParentNode = document,
): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

/** Closest ancestor (or self) matching any selector. */
export function closestAny(
  target: EventTarget | null,
  selectors: readonly string[],
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  for (const selector of selectors) {
    const el = target.closest<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/** Generic composer: a visible editable textbox. */
const GENERIC_COMPOSER = [
  '[contenteditable="true"][role="textbox"]',
  'div.ProseMirror[contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  'form textarea',
] as const;

/** "Send" in English or Arabic UI labels. */
const SEND_LABEL = /\bsend\b|إرسال|ارسال|أرسل/i;

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function looksLikeSend(button: HTMLElement): boolean {
  const label = [
    button.getAttribute('aria-label'),
    button.getAttribute('title'),
    button.getAttribute('data-testid'),
    button.className,
  ].join(' ');
  return SEND_LABEL.test(label);
}

/**
 * Walk up from the composer (a few levels) and return the first visible button
 * that looks like "Send". Keeps the search local to the input area so other
 * page buttons labelled "send" (e.g. "Send feedback") are not picked.
 */
export function findSendButtonNear(composer: HTMLElement | null, maxLevels = 7): HTMLElement | null {
  let node: HTMLElement | null = composer;
  for (let level = 0; node && level < maxLevels; level += 1) {
    node = node.parentElement;
    if (!node) break;
    for (const button of node.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      if (isVisible(button) && looksLikeSend(button)) return button;
    }
  }
  return null;
}

export interface AdapterSpec {
  id: PlatformAdapter['id'];
  composer: readonly string[];
  sendButton: readonly string[];
}

/** Build an adapter: known selectors first, generic fallbacks second. */
export function createAdapter(spec: AdapterSpec): PlatformAdapter {
  const getComposer = (): HTMLElement | null =>
    queryFirst(spec.composer) ?? queryFirst(GENERIC_COMPOSER);
  const getSendButton = (): HTMLElement | null =>
    queryFirst(spec.sendButton) ?? findSendButtonNear(getComposer());
  return {
    id: spec.id,
    getComposer,
    getSendButton,
    isSendButton(target) {
      if (closestAny(target, spec.sendButton)) return true;
      const button = closestAny(target, ['button', '[role="button"]']);
      return !!button && button === getSendButton();
    },
  };
}
