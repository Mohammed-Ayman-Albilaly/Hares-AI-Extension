/**
 * Hares AI — which copy of the content script owns this page.
 *
 * Each copy writes its own id on the page. When the extension is reloaded and a
 * newer copy is injected, the older, cut-off copy sees another id and steps aside
 * without telling the user to refresh.
 */

const ATTRIBUTE = 'data-hares-instance';

/** Mark this page as owned by a new copy of the script, and return its id. */
export function claimPage(): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    document.documentElement.setAttribute(ATTRIBUTE, id);
  } catch {
    // Nothing to mark yet; the copy still works.
  }
  return id;
}

/** True when a newer copy has claimed the page after `id`. */
export function isSuperseded(id: string): boolean {
  try {
    const current = document.documentElement.getAttribute(ATTRIBUTE);
    return current !== null && current !== id;
  } catch {
    return false;
  }
}
