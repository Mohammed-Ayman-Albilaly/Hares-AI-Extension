/**
 * Hares AI — loop prevention.
 *
 * After the user (or the policy) approves a text, the next send of exactly that
 * text must go through without being analysed again; otherwise re-firing the
 * send would re-open the dialog forever.
 *
 * - `approveOnce`: a short-lived pass for the send we are about to re-fire.
 *   It stays valid until `ttlMs` passes (not consumed on first use), because
 *   one send can fire several events — e.g. the button click, then the form
 *   submit.
 * - `trust`: texts we produced ourselves (the revised prompt). They stay
 *   trusted for the tab session, so a user who copies the revised text and
 *   pastes it back is not asked again.
 *
 * Texts are compared after whitespace normalization, because editors re-flow
 * spaces and line breaks.
 */

export function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export class ApprovalStore {
  private pending: { text: string; expires: number } | null = null;
  private trusted = new Set<string>();

  constructor(
    private readonly ttlMs = 2000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  approveOnce(text: string, ttlMs = this.ttlMs): void {
    this.pending = { text: normalizeForCompare(text), expires: this.now() + ttlMs };
  }

  trust(text: string): void {
    this.trusted.add(normalizeForCompare(text));
  }

  /** Should this send pass without analysis? */
  allows(text: string): boolean {
    const key = normalizeForCompare(text);
    if (this.pending && this.pending.expires >= this.now() && this.pending.text === key) {
      return true;
    }
    return this.trusted.has(key);
  }

  clearPending(): void {
    this.pending = null;
  }
}
