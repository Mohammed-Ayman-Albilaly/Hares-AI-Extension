/**
 * Hares AI — placeholder vault: the masking "tool + memory".
 *
 * Replaces detected values with category placeholders (`[EMAIL_1]`) following
 * docs/Hares AI.pdf Algorithm 15.2 (replace from the end backwards so earlier
 * offsets stay valid), and remembers value ↔ placeholder per conversation so
 * the same value always gets the same placeholder and `unmask` can restore it
 * locally.
 *
 * The vault holds raw sensitive values. It must only ever be persisted to
 * `chrome.storage.session` (memory-only) and never logged or sent anywhere.
 */

import { UNMASKED_CATEGORIES } from '../detectors/categories';
import type { Detection } from '../detectors/types';

export interface VaultEntry {
  placeholder: string;
  label: string;
  value: string;
}

/** Serializable vault state for `chrome.storage.session`. */
export interface VaultSnapshot {
  entries: VaultEntry[];
  counters: Record<string, number>;
}

export interface MaskResult {
  masked: string;
  /** Detections that were replaced (KEYWORD-style detections are skipped). */
  replaced: Detection[];
}

const PLACEHOLDER_RE = /\[([A-Z][A-Z0-9_]*?)_(\d+)\]/g;

export class PlaceholderVault {
  private byKey = new Map<string, VaultEntry>();
  private byPlaceholder = new Map<string, VaultEntry>();
  private counters: Record<string, number> = {};

  static fromSnapshot(snapshot: VaultSnapshot): PlaceholderVault {
    const vault = new PlaceholderVault();
    vault.counters = { ...snapshot.counters };
    for (const entry of snapshot.entries) vault.remember(entry);
    return vault;
  }

  /** Same label + value (case-insensitive, trimmed) → same placeholder. */
  private static key(label: string, value: string): string {
    return `${label}\u0000${value.trim().toLowerCase()}`;
  }

  private remember(entry: VaultEntry): void {
    this.byKey.set(PlaceholderVault.key(entry.label, entry.value), entry);
    this.byPlaceholder.set(entry.placeholder, entry);
  }

  /** Get the existing placeholder for a value, or allocate the next one. */
  placeholderFor(label: string, value: string): string {
    const existing = this.byKey.get(PlaceholderVault.key(label, value));
    if (existing) return existing.placeholder;
    const n = (this.counters[label] ?? 0) + 1;
    this.counters[label] = n;
    const entry = { placeholder: `[${label}_${n}]`, label, value };
    this.remember(entry);
    return entry.placeholder;
  }

  /**
   * Replace every maskable detection with its placeholder. `detections` must be
   * non-overlapping (as returned by `mergeDetections`).
   */
  mask(text: string, detections: readonly Detection[]): MaskResult {
    const replaced = detections
      .filter((d) => !UNMASKED_CATEGORIES.has(d.category))
      .sort((a, b) => a.start - b.start);
    // Allocate in reading order so numbering follows the text.
    const placeholders = replaced.map((d) => this.placeholderFor(d.label, d.value));
    let masked = text;
    for (let i = replaced.length - 1; i >= 0; i -= 1) {
      const d = replaced[i]!;
      masked = masked.slice(0, d.start) + placeholders[i]! + masked.slice(d.end);
    }
    return { masked, replaced };
  }

  /** Restore known placeholders to their original values; unknown ones stay. */
  unmask(text: string): string {
    return text.replace(PLACEHOLDER_RE, (whole) => this.byPlaceholder.get(whole)?.value ?? whole);
  }

  entries(): VaultEntry[] {
    return [...this.byPlaceholder.values()];
  }

  clear(): void {
    this.byKey.clear();
    this.byPlaceholder.clear();
    this.counters = {};
  }

  snapshot(): VaultSnapshot {
    return { entries: this.entries(), counters: { ...this.counters } };
  }
}
