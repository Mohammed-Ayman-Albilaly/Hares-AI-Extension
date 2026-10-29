/**
 * Hares AI — ask the background for a current policy before a message is scanned.
 *
 * The background answers when its check is done (or immediately if the last
 * one is recent). This never throws and never waits long: if the background
 * cannot be reached, the scan continues with the stored policy.
 */

import { browser } from 'wxt/browser';
import { MSG, TARGET, type PolicyFreshRequest } from '../messaging/protocol';

/** Longer than the background's own wait, so its answer normally arrives first. */
const ASK_TIMEOUT_MS = 2200;

export async function requestFreshPolicy(timeoutMs = ASK_TIMEOUT_MS): Promise<void> {
  const request: PolicyFreshRequest = { target: TARGET.BACKGROUND, type: MSG.POLICY_FRESH };
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  const ask = Promise.resolve(browser.runtime.sendMessage(request)).then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([ask, timeout]);
}
