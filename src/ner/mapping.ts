/**
 * Hares AI — model entity spans → Detection objects (same shape as the rules).
 *
 * Applies, in order: the policy's enabled model types, the minimum score, and
 * the same checksum validators the rules use where a type has one (a "credit
 * card" the model sees must still pass Luhn), so the model cannot raise a false
 * HIGH on a random number.
 */

import type { Detection } from '../detectors/types';
import { card, saudiId } from '../detectors/validators';
import { enabledModelLabels, MODEL_LABELS } from './labels';
import { MIN_SCORE } from './runner';
import type { EntitySpan } from './spans';

/** Extra checks for types where a wrong HIGH is costly. */
function passesValidation(type: string, value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (type === 'CREDIT_CARD') return card(value);
  // A 10-digit number starting with 1 or 2 is a Saudi ID / iqama format: require its checksum.
  if (type === 'NATIONAL_ID' && /^[12]\d{9}$/.test(digits)) return saudiId(digits);
  return true;
}

export function entitiesToDetections(
  text: string,
  entities: readonly EntitySpan[],
  enabledLabels?: readonly string[],
): Detection[] {
  const enabled = enabledModelLabels(enabledLabels);
  const detections: Detection[] = [];
  for (const e of entities) {
    const mapping = MODEL_LABELS[e.type];
    if (!mapping || !enabled.has(e.type) || e.score < MIN_SCORE) continue;
    if (e.start < 0 || e.end > text.length || e.end <= e.start) continue;
    const value = text.slice(e.start, e.end);
    if (!passesValidation(e.type, value)) continue;
    detections.push({
      category: mapping.category,
      label: mapping.label,
      value,
      start: e.start,
      end: e.end,
      source: 'ner',
      confidence: e.score,
    });
  }
  return detections;
}
