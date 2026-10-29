/**
 * Hares AI — hand a log event to the background service worker.
 *
 * The background queues it and uploads it; if the user is not signed in, it is
 * dropped there. Logging must never get in the way of sending, so this never
 * throws.
 */

import { browser } from 'wxt/browser';
import { MSG, TARGET, type LogEventMessage } from '../messaging/protocol';
import { isContextInvalidatedError, isExtensionContextValid } from '../runtime/context';
import type { EventDraft } from './event';

export async function reportEvent(event: EventDraft): Promise<void> {
  // The extension was reloaded under this page: stop reporting without noise.
  if (!isExtensionContextValid()) return;
  const message: LogEventMessage = { target: TARGET.BACKGROUND, type: MSG.LOG_EVENT, event };
  try {
    await browser.runtime.sendMessage(message);
  } catch (error) {
    if (isContextInvalidatedError(error)) return;
    // The service worker could not be reached; the event is lost, the send is not.
    console.warn('[hares] failed to report log event:', error instanceof Error ? error.message : error);
  }
}
