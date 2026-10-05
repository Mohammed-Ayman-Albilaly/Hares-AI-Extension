/**
 * Hares AI — send interceptor (shared by all platforms).
 *
 * Catches a send attempt (Enter in the composer, a click on the send button, or
 * a form submit) in the capture phase on `window`, so it runs before the site's
 * own handlers. Then:
 *
 *   SAFE   → re-send immediately, nothing shown
 *   LOW    → re-send immediately + a quiet toast
 *   MEDIUM → dialog: Confirm (original) / Send revised / Edit
 *   HIGH   → dialog: Send revised / Edit (original never sent)
 *
 * Re-sending goes through the same listeners; the ApprovalStore lets exactly
 * the approved text through once, so we never loop.
 */

import { readComposerText, replaceComposerText, waitForEnabled } from '../adapters/editor';
import type { PlatformAdapter } from '../adapters/types';
import { queueLogEvent, type UserAction } from '../logging/events';
import { analyzePrompt, type AnalysisResult } from '../pipeline/analyze';
import { ConversationTracker } from '../pipeline/conversation';
import { isDialogOpen, showDecisionDialog } from '../ui/dialog';
import { showToast } from '../ui/toast';
import { ApprovalStore } from './approval';

export function installInterceptor(adapter: PlatformAdapter): void {
  const approvals = new ApprovalStore();
  const conversations = new ConversationTracker();
  let busy = false;

  function isInComposer(target: EventTarget | null): boolean {
    const composer = adapter.getComposer();
    return !!composer && target instanceof Node && composer.contains(target);
  }

  /** Decide whether this send attempt may pass untouched; otherwise hold it. */
  function intercept(event: Event): void {
    if (isDialogOpen() || busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const composer = adapter.getComposer();
    if (!composer) return;
    const text = readComposerText(composer);
    if (!text.trim()) return; // nothing to send — let the site handle it
    if (approvals.allows(text)) {
      // Approved re-send (or a revised text pasted back): it goes out as-is.
      conversations.recordSend(text);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void handle(text);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (!isInComposer(event.target)) return;
    intercept(event);
  }

  function onClick(event: MouseEvent): void {
    if (!adapter.isSendButton(event.target)) return;
    intercept(event);
  }

  function onSubmit(event: SubmitEvent): void {
    const composer = adapter.getComposer();
    if (!composer || !(event.target instanceof HTMLFormElement) || !event.target.contains(composer)) return;
    intercept(event);
  }

  async function resend(text: string): Promise<boolean> {
    approvals.approveOnce(text);
    const button = await waitForEnabled(() => adapter.getSendButton());
    if (!button) {
      approvals.clearPending();
      showToast('Hares AI could not press send. Press Enter to send.', 'info', 4000);
      return false;
    }
    button.click();
    return true;
  }

  function log(analysis: AnalysisResult, action: UserAction): void {
    void queueLogEvent({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      platform: adapter.id,
      tier: analysis.decision.tier,
      categories: analysis.decision.categories,
      detectionCount: analysis.detections.length,
      action,
      analysisMs: analysis.latencyMs,
    });
  }

  async function sendRevised(analysis: AnalysisResult): Promise<void> {
    approvals.trust(analysis.revised);
    const composer = adapter.getComposer();
    const replaced = composer ? await replaceComposerText(composer, analysis.revised) : false;
    if (replaced) {
      await resend(analysis.revised);
      log(analysis, 'sent_revised');
      return;
    }
    // Fallback: the editor did not accept our text. Hand it to the user instead.
    try {
      await navigator.clipboard.writeText(analysis.revised);
      showToast('Revised message copied. Replace your text with Ctrl+V, then send.', 'info', 6000);
      log(analysis, 'copied_revised');
    } catch {
      showToast('Hares AI could not update or copy the revised message. Please edit it manually.', 'HIGH', 6000);
      log(analysis, 'cancelled');
    }
  }

  async function handle(text: string): Promise<void> {
    busy = true;
    try {
      const conversation = conversations.current();
      const analysis = analyzePrompt(text, conversation.vault, {
        historyTail: conversation.historyTail(),
      });
      const { tier } = analysis.decision;

      if (tier === 'SAFE' || tier === 'LOW') {
        busy = false; // release before re-sending so the click is not swallowed
        await resend(text);
        if (tier === 'LOW') showToast('Low risk: possibly sensitive wording noticed.', 'LOW');
        log(analysis, 'auto_sent');
        return;
      }

      busy = false;
      const choice = await showDecisionDialog(analysis);
      if (choice === 'original' && tier !== 'HIGH') {
        await resend(text);
        log(analysis, 'sent_original');
      } else if (choice === 'revised') {
        await sendRevised(analysis);
      } else {
        log(analysis, 'cancelled');
        adapter.getComposer()?.focus();
      }
    } catch (error) {
      // Never leave the user stuck: fail visibly, and let the next Enter through.
      console.error('[hares] analysis failed:', error);
      approvals.approveOnce(text, 60_000);
      showToast('Hares AI could not analyse this message. Press Enter again to send.', 'info', 4000);
    } finally {
      busy = false;
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('submit', onSubmit, true);
  console.info(`[hares] send interceptor installed (${adapter.id})`);
}
