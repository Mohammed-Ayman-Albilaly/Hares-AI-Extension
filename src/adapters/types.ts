/**
 * Hares AI — per-platform adapter contract.
 *
 * Everything that depends on a site's DOM lives behind this interface, so the
 * interceptor and UI are shared across ChatGPT, Claude and Gemini. Sites change
 * their markup often; each adapter lists several selectors, most specific first.
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
