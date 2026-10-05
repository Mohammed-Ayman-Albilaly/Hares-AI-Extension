/**
 * Hares AI — prompt log events (local queue; backend sync comes later).
 *
 * One event per analysed send. It carries NO prompt text — only metadata the
 * admin dashboard needs (docs/Hares AI.pdf 6.1.5, 6.1.9.1). Events are queued
 * in `chrome.storage.local`; a later phase drains the queue to the backend.
 */

import { browser } from 'wxt/browser';
import type { CategoryId, Tier } from '../detectors/categories';

export type UserAction =
  | 'auto_sent' // SAFE / LOW: sent without asking
  | 'sent_original' // MEDIUM: user confirmed the original
  | 'sent_revised' // user sent the masked version
  | 'copied_revised' // editor could not be updated; revised text copied instead
  | 'cancelled'; // user went back to editing

export interface PromptLogEvent {
  id: string;
  at: string;
  platform: string;
  tier: Tier;
  categories: CategoryId[];
  detectionCount: number;
  action: UserAction;
  analysisMs: number;
}

const QUEUE_KEY = 'hares.logQueue';
const MAX_QUEUED = 500;

export async function queueLogEvent(event: PromptLogEvent): Promise<void> {
  try {
    const stored = await browser.storage.local.get(QUEUE_KEY);
    const queue = (stored[QUEUE_KEY] as PromptLogEvent[] | undefined) ?? [];
    queue.push(event);
    await browser.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUED) });
  } catch (error) {
    // Logging must never break sending.
    console.warn('[hares] failed to queue log event:', error);
  }
}
