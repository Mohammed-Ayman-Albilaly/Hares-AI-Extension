/**
 * Hares AI — read and replace text in a site's composer.
 *
 * ChatGPT and Claude use ProseMirror, Gemini uses Quill, and some fallbacks are
 * plain <textarea>s. Writing `innerText` directly does not update the editor's
 * own state, so the site would still send the old text. Instead we select all
 * and go through paths the editors listen to — a synthetic paste first, then
 * `insertText` — and verify by reading the text back.
 */

import { normalizeForCompare } from '../interceptor/approval';

export function readComposerText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  return el.innerText ?? el.textContent ?? '';
}

function selectAllIn(el: HTMLElement): void {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.select();
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

function matches(el: HTMLElement, text: string): boolean {
  return normalizeForCompare(readComposerText(el)) === normalizeForCompare(text);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setTextareaValue(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  // React tracks the value through the prototype setter; call it directly so
  // the framework sees the change, then fire `input`.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function tryPaste(el: HTMLElement, text: string): void {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  el.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  );
}

function tryInsertText(_el: HTMLElement, text: string): void {
  // Deprecated but still the most widely honoured "user typed this" path.
  document.execCommand('insertText', false, text);
}

/**
 * Replace the composer's whole content with `text`. Resolves true only if the
 * editor verifiably holds `text` afterwards.
 */
export async function replaceComposerText(el: HTMLElement, text: string): Promise<boolean> {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setTextareaValue(el, text);
    await nextFrame();
    return matches(el, text);
  }

  for (const attempt of [tryPaste, tryInsertText]) {
    selectAllIn(el);
    attempt(el, text);
    await nextFrame();
    if (matches(el, text)) return true;
  }
  return false;
}

/** Wait until `get()` returns an enabled element, or give up after `timeoutMs`. */
export async function waitForEnabled(
  get: () => HTMLElement | null,
  timeoutMs = 1500,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = get();
    if (el && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true') {
      return el;
    }
    await nextFrame();
  }
  return null;
}
