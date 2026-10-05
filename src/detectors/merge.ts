/**
 * Hares AI — resolve overlapping detections (docs/Hares AI.pdf Algorithm 15.1,
 * `RemoveOverlaps`).
 *
 * The PDF version only drops spans fully contained in another span, which
 * drops *both* of two identical spans and keeps partial overlaps (breaking
 * masking). This version is greedy: rank by priority, accept a span only if it
 * overlaps nothing already accepted, then sort by start offset.
 */

import { CATEGORIES, TIER_RANK, type CategoryId } from './categories';
import type { Detection } from './types';

/** Catch-all categories that lose to any specific match of the same tier. */
const GENERIC: ReadonlySet<CategoryId> = new Set(['NUMERIC', 'WEB_LINK', 'KEYWORD']);

function priority(d: Detection): number[] {
  return [
    TIER_RANK[CATEGORIES[d.category].tier],
    GENERIC.has(d.category) ? 0 : 1,
    d.source === 'rule' ? 1 : 0,
    d.end - d.start,
    d.confidence,
  ];
}

function compareDesc(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function mergeDetections(detections: readonly Detection[]): Detection[] {
  const ranked = [...detections].sort((a, b) => compareDesc(priority(a), priority(b)));
  const accepted: Detection[] = [];
  for (const d of ranked) {
    if (d.end <= d.start) continue;
    const overlaps = accepted.some((a) => d.start < a.end && a.start < d.end);
    if (!overlaps) accepted.push(d);
  }
  return accepted.sort((a, b) => a.start - b.start);
}
