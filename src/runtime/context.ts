/**
 * Hares AI — has this page's copy of the extension been reloaded or removed?
 *
 * After the extension is reloaded, updated or removed, the content script that
 * is already in a page keeps running but every `browser.*` call fails with
 * "Extension context invalidated". That is not a bug to report: the page needs a
 * refresh to get the new script. Callers use these checks to stop quietly.
 */

import { browser } from 'wxt/browser';

/** The extension id disappears from `runtime` once the context is gone. */
export function isExtensionContextValid(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

export function isContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /extension context invalidated/i.test(message);
}
