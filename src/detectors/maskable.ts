/**
 * Hares AI — can a detection be replaced by a placeholder?
 *
 * Most detections are a span of text (an email, a card number) that the
 * revised message replaces with a placeholder. Two kinds cannot be masked:
 * report-only categories (sensitive keywords), and matches about the message
 * as a whole (a TOPIC rule), which have no span to replace.
 */

import { UNMASKED_CATEGORIES } from './categories';
import type { Detection } from './types';

export function isMaskable(d: Detection): boolean {
  return d.wholeMessage !== true && !UNMASKED_CATEGORIES.has(d.category);
}
