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
import { buildEventDraft, type UserAction } from '../logging/event';
import { reportEvent } from '../logging/report';
import { analyzePrompt, type AnalysisResult } from '../pipeline/analyze';
import { isContextInvalidatedError, isExtensionContextValid } from '../runtime/context';
import { createThrottle } from '../runtime/throttle';
import { claimPage, isSuperseded } from '../runtime/instance';
import { ConversationTracker } from '../pipeline/conversation';
import { requestFreshPolicy } from '../policy/fresh';
import { PolicyState } from '../policy/store';
import { isDialogOpen, showDecisionDialog } from '../ui/dialog';
import { showStatus, showToast } from '../ui/toast';
import { requestEntities, warmUpDetector, type DetectorOutcome } from '../ner/client';
import { entitiesToDetections } from '../ner/mapping';
import { requestTopicScores, warmUpTopicModel } from '../topics/client';
import { topicDetections } from '../topics/detect';
import { sameHypotheses, topicRulesOf } from '../topics/rules';
import { ApprovalStore } from './approval';

/** A model left alone for this long is run once before it is needed again. */
const WARM_UP_EVERY_MS = 60_000;

export function installInterceptor(adapter: PlatformAdapter): void {
  const approvals = new ApprovalStore();
  const conversations = new ConversationTracker();
  // Department policy + user exceptions; starts on the built-in default and
  // switches as soon as the stored policy is loaded (and on every change).
  const policyState = new PolicyState();
  /**
   * The local models are several times slower on their first run after sitting
   * idle, slow enough to pass their time limit, and then they contribute
   * nothing. So they are run once on nothing when the page opens and when the
   * user starts typing after a pause: by the time Enter is pressed they are hot.
   * The decision model is only touched when the policy has TOPIC rules.
   */
  const warm = createThrottle(WARM_UP_EVERY_MS);
  function warmUpModels(): void {
    if (!warm.ready() || !isExtensionContextValid()) return;
    warmUpDetector();
    if (topicRulesOf(policyState.policy).length > 0) warmUpTopicModel();
  }
  void policyState.start().then(warmUpModels);
  let busy = false;
  /** Tell the user once per page that the detector is still downloading. */
  let toldModelLoading = false;

  /**
   * Everything a message waits for, showing "checking…" if it takes more than
   * 300 ms: the current policy, the detection model (names, addresses…) and,
   * when the policy has TOPIC rules, the decision model. Neither model can block
   * the send: one that is not ready or too slow simply contributes nothing.
   *
   * Nothing waits for the policy check, which is a network round trip of up to
   * a second. The detection model does not depend on the policy at all. The
   * decision model starts on the topics of the policy stored right now; in the
   * rare case that the check brings different topics, it is asked again.
   */
  async function modelDetectionsFor(text: string) {
    const started = performance.now();
    let dismiss: (() => void) | null = null;
    const indicator = setTimeout(() => {
      dismiss = showStatus('Hares AI: checking…');
    }, 300);
    const detecting = requestEntities(text);
    const score = (list: ReturnType<typeof topicRulesOf>) =>
      list.length > 0 ? requestTopicScores(text, list.map((t) => t.hypothesis)) : null;
    await policyState.refresh();
    const storedTopics = topicRulesOf(policyState.policy);
    const scoringStored = score(storedTopics);
    // Always decide under the current policy: have the background check it if
    // the last check is not recent, then read what is stored right now.
    await requestFreshPolicy();
    await policyState.refresh();
    const policyMs = Math.round(performance.now() - started);
    const topics = topicRulesOf(policyState.policy);
    // Same descriptions in the same order: the scores already under way fit the
    // new rules (their thresholds and actions are applied afterwards).
    const scoring = sameHypotheses(storedTopics, topics) ? scoringStored : score(topics);
    const [result, topicResult] = await Promise.all([detecting, scoring]);
    clearTimeout(indicator);
    (dismiss as (() => void) | null)?.();
    warm.touch();
    console.info(
      `[hares] check took ${Math.round(performance.now() - started)} ms (policy ${policyMs} ms, detection ${result.latencyMs ?? result.outcome}${
        topicResult ? `, ${topics.length} topics ${topicResult.latencyMs ?? topicResult.outcome}` : ''
      }; model times are the worker's own)`,
    );
    if (result.outcome === 'loading' && !toldModelLoading) {
      toldModelLoading = true;
      showToast('Hares AI is still downloading its name & address detector. Checked with rules only for now.', 'info', 5000);
    }
    if (topicResult && topicResult.outcome !== 'ready') {
      console.info(`[hares] topic rules not applied to this message (decision model: ${topicResult.outcome})`);
    }
    const detections = entitiesToDetections(text, result.entities);
    return { outcome: result.outcome, detections, topics: topicResult ? topicDetections(topics, topicResult.scores) : [] };
  }

  function isInComposer(target: EventTarget | null): boolean {
    return adapter.isComposer(target);
  }

  /**
   * The extension was reloaded or updated while this page stayed open: this
   * copy of the script can no longer reach it. Stop intercepting (the site works
   * as usual), say so once, and ask for a refresh. Nothing is logged as an error.
   */
  const instanceId = claimPage();
  let retired = false;
  function retire(): void {
    if (retired) return;
    retired = true;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('submit', onSubmit, true);
    // A newer copy was injected by the extension itself: it protects the page, nothing to tell.
    if (!isSuperseded(instanceId)) showToast('Hares AI was updated. Refresh this page to turn protection back on.', 'info', 8000);
  }

  /** Decide whether this send attempt may pass untouched; otherwise hold it. */
  function intercept(event: Event): void {
    if (!isExtensionContextValid()) {
      retire();
      return;
    }
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
    lastTrigger = event.type === 'keydown' ? 'Enter' : event.type === 'click' ? 'send button' : 'form submit';
    void handle(text);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      // Typing has started: get the models ready while the user writes.
      warmUpModels();
      return;
    }
    if (event.shiftKey || event.isComposing || event.keyCode === 229) return;
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

  let lastDetector: DetectorOutcome = 'idle';
  /** What the user did to send, for the console trace of each reported event. */
  let lastTrigger = 'unknown';

  /** One event per analysed send: metadata only, never the text. */
  function log(analysis: AnalysisResult, userAction: UserAction): void {
    const event = buildEventDraft({
      decision: analysis.decision,
      detections: analysis.detections,
      platform: adapter.id,
      // A TOPIC match is a decision of the local model, whatever the detection model's state.
      detector: analysis.detections.some((d) => d.wholeMessage) ? 'ready' : lastDetector,
      userAction,
      now: Date.now(),
      logId: crypto.randomUUID(),
    });
    if (!event) return;
    // Events exist only for a send attempt (Enter, the send button or a form submit); typing alone never reaches here.
    console.info(`[hares] send attempt via ${lastTrigger}: ${event.action}, risk ${event.risk_level}, decision ${event.user_decision} (event ${event.log_id})`);
    void reportEvent(event);
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
      const model = await modelDetectionsFor(text);
      const conversation = conversations.current();
      lastDetector = model.outcome;
      const analysis = analyzePrompt(text, conversation.vault, {
        modelDetections: model.detections,
        topicDetections: model.topics,
        historyTail: conversation.historyTail(),
        policy: policyState.policy,
        exceptions: policyState.exceptions,
      });
      const { tier } = analysis.decision;

      if (tier === 'SAFE' || tier === 'LOW') {
        busy = false; // release before re-sending so the click is not swallowed
        await resend(text);
        if (analysis.decision.exceptedLabels.length > 0) {
          const names = analysis.decision.exceptedLabels.join(', ');
          showToast(`Sent under your personal exception (${names}). Still logged as ${analysis.decision.policyTier}.`, 'LOW', 4500);
        } else if (tier === 'LOW') {
          showToast('Low risk: possibly sensitive wording noticed.', 'LOW');
        }
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
        log(analysis, choice === 'edit' ? 'edited' : 'cancelled');
        adapter.getComposer()?.focus();
      }
    } catch (error) {
      if (isContextInvalidatedError(error) || !isExtensionContextValid()) {
        retire();
        return;
      }
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
