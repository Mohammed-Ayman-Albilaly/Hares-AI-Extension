/**
 * Hares AI — content-script side of the detection model.
 *
 * Asks the background (→ offscreen → worker) for entity spans with a hard
 * timeout. It never throws and never blocks the user: if the model is still
 * downloading, failed, or is slow, the caller gets an empty result and a status
 * and continues with the rules alone.
 */

import { browser } from 'wxt/browser';
import { MSG, TARGET, type DetectRequest, type DetectResponse, type ModelStatus } from '../messaging/protocol';
import type { EntitySpan } from './spans';

/** How long a send may wait for the model before going ahead with rules only. */
export const DETECT_TIMEOUT_MS = 2500;

export type DetectorOutcome = ModelStatus | 'timeout' | 'disabled';

export interface ModelDetectResult {
  outcome: DetectorOutcome;
  entities: EntitySpan[];
  latencyMs?: number;
}

export async function requestEntities(text: string, timeoutMs = DETECT_TIMEOUT_MS): Promise<ModelDetectResult> {
  const request: DetectRequest = { target: TARGET.BACKGROUND, type: MSG.DETECT, id: crypto.randomUUID(), text };
  const timeout = new Promise<ModelDetectResult>((resolve) =>
    setTimeout(() => resolve({ outcome: 'timeout', entities: [] }), timeoutMs),
  );
  const ask = (async (): Promise<ModelDetectResult> => {
    try {
      const response = (await browser.runtime.sendMessage(request)) as DetectResponse | undefined;
      if (!response) return { outcome: 'error', entities: [] };
      return {
        outcome: response.status,
        entities: response.status === 'ready' ? (response.entities ?? []) : [],
        latencyMs: response.latencyMs,
      };
    } catch {
      return { outcome: 'error', entities: [] };
    }
  })();
  return Promise.race([ask, timeout]);
}
