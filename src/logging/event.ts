/**
 * Hares AI — activity-log events for the backend (`POST /logs`).
 *
 * One event per analysed send, with metadata only: never the prompt text or
 * any part of it. The backend accepts a strict allowlist of fields (an extra
 * one is a 400), so `toLogEvent` copies field by field. `user_id` and
 * `department_id` are not sent: the backend takes them from the token.
 *
 * Rules (agreed with the backend):
 *   risk_level  = highest risk among the detections (NONE if nothing matched)
 *   action      = the policy outcome: BLOCKED / WARNED / ALLOWED; it does not
 *                 change with what the user did afterwards (see user_decision)
 *   categories  = distinct contract codes; organisation rules add none
 *   rule_id     = the matched rule with the strictest action, then the highest
 *                 risk, then the first in the bundle; null when no rule matched
 */

import { isCategoryCode, toContractCode, type CategoryCode } from '../contract/categories';
import { isRiskLevel, logActionFromTier, riskFromTier, type LogAction, type RiskLevel } from '../contract/enums';
import { TIER_RANK } from '../detectors/categories';
import type { Detection } from '../detectors/types';
import type { DetectorOutcome } from '../ner/client';
import type { Decision } from '../policy/decision';

export const SCHEMA_VERSION = 1;

export type Platform = 'CHATGPT' | 'GEMINI' | 'CLAUDE';
export type ClassificationSource = 'LOCAL' | 'LOCAL_AI' | 'LOCAL_ONLY_FALLBACK';
export type UserDecision = 'NONE' | 'SUBMITTED_ANYWAY' | 'EDITED' | 'REVISION_USED' | 'CANCELLED';

/** What the user did with this message. */
export type UserAction =
  | 'auto_sent' // sent without a dialog (clean, or ALLOWED)
  | 'sent_original' // WARNED: the user pressed Confirm
  | 'sent_revised' // the user sent the masked version
  | 'copied_revised' // the editor refused the masked text; it was copied for the user to paste
  | 'edited' // the Edit button: back to the composer
  | 'cancelled'; // the dialog was dismissed (Escape, click outside) or nothing could be sent

const PLATFORMS: Readonly<Record<string, Platform>> = { chatgpt: 'CHATGPT', gemini: 'GEMINI', claude: 'CLAUDE' };
const PLATFORM_VALUES: readonly string[] = ['CHATGPT', 'GEMINI', 'CLAUDE'];
const SOURCES: readonly string[] = ['LOCAL', 'LOCAL_AI', 'LOCAL_ONLY_FALLBACK'];
const DECISIONS: readonly string[] = ['NONE', 'SUBMITTED_ANYWAY', 'EDITED', 'REVISION_USED', 'CANCELLED'];
const ACTIONS: readonly string[] = ['BLOCKED', 'WARNED', 'ALLOWED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An event as created in the page and queued: the time is still the device's. */
export interface EventDraft {
  /** Idempotency key: every retry of this event sends the same one. */
  log_id: string;
  /** Device clock, epoch ms. Corrected with the server's clock when sent. */
  occurred_at: number;
  platform: Platform;
  risk_level: RiskLevel;
  action: LogAction;
  categories: CategoryCode[];
  classification_source: ClassificationSource;
  user_decision: UserDecision;
  rule_id: string | null;
  schema_version: typeof SCHEMA_VERSION;
}

/** The body of `POST /logs`. */
export interface LogEvent {
  log_id: string;
  event_time: string;
  platform: Platform;
  risk_level: RiskLevel;
  action: LogAction;
  categories: CategoryCode[];
  classification_source: ClassificationSource;
  user_decision: UserDecision;
  rule_id: string | null;
  schema_version: typeof SCHEMA_VERSION;
}

export function userDecisionFor(action: UserAction): UserDecision {
  switch (action) {
    case 'auto_sent':
      return 'NONE';
    case 'sent_original':
      return 'SUBMITTED_ANYWAY';
    case 'sent_revised':
    case 'copied_revised':
      return 'REVISION_USED';
    case 'edited':
      return 'EDITED';
    case 'cancelled':
      return 'CANCELLED';
  }
}

/** LOCAL_AI: the detection model ran. LOCAL: it is switched off. Anything else: it should have run but could not. */
export function classificationSourceFor(outcome: DetectorOutcome): ClassificationSource {
  if (outcome === 'ready') return 'LOCAL_AI';
  if (outcome === 'disabled') return 'LOCAL';
  return 'LOCAL_ONLY_FALLBACK';
}

/** Distinct contract codes of the detections; rule matches and unmapped categories add none. */
export function contractCategories(detections: readonly Detection[]): CategoryCode[] {
  const codes = new Set<CategoryCode>();
  for (const d of detections) {
    if (d.rule) continue;
    const code = toContractCode(d.category);
    if (code) codes.add(code);
  }
  return [...codes];
}

/** The matched rule with the strictest action, then the highest risk, then the first in the bundle. */
export function pickRuleId(detections: readonly Detection[]): string | null {
  let best: NonNullable<Detection['rule']> | null = null;
  for (const { rule } of detections) {
    if (!rule) continue;
    if (
      !best ||
      TIER_RANK[rule.enforce] > TIER_RANK[best.enforce] ||
      (rule.enforce === best.enforce &&
        (TIER_RANK[rule.risk] > TIER_RANK[best.risk] || (rule.risk === best.risk && rule.order < best.order)))
    ) {
      best = rule;
    }
  }
  return best?.id ?? null;
}

export interface EventInput {
  decision: Pick<Decision, 'risk' | 'policyTier'>;
  detections: readonly Detection[];
  /** The adapter id: chatgpt | claude | gemini. */
  platform: string;
  detector: DetectorOutcome;
  userAction: UserAction;
  /** Device time, epoch ms. */
  now: number;
  logId: string;
}

/** Build the event for one analysed send, or null for a platform the backend does not know. */
export function buildEventDraft(input: EventInput): EventDraft | null {
  const platform = PLATFORMS[input.platform];
  if (!platform) return null;
  return {
    log_id: input.logId,
    occurred_at: input.now,
    platform,
    risk_level: riskFromTier(input.decision.risk),
    action: logActionFromTier(input.decision.policyTier),
    categories: contractCategories(input.detections),
    classification_source: classificationSourceFor(input.detector),
    user_decision: userDecisionFor(input.userAction),
    rule_id: contractRuleId(pickRuleId(input.detections)),
    schema_version: SCHEMA_VERSION,
  };
}

/** The contract wants a UUID; anything else is sent as no rule rather than losing the event. */
function contractRuleId(id: string | null): string | null {
  return id !== null && UUID.test(id) ? id : null;
}

/** The request body: the allowlisted fields only, with the time corrected by `offsetMs`. */
export function toLogEvent(draft: EventDraft, offsetMs: number): LogEvent {
  return {
    log_id: draft.log_id,
    event_time: new Date(draft.occurred_at + offsetMs).toISOString(),
    platform: draft.platform,
    risk_level: draft.risk_level,
    action: draft.action,
    categories: [...draft.categories],
    classification_source: draft.classification_source,
    user_decision: draft.user_decision,
    rule_id: draft.rule_id,
    schema_version: draft.schema_version,
  };
}

/** Is `value` a well-formed event draft? Used on everything that arrives over IPC or from storage. */
export function isEventDraft(value: unknown): value is EventDraft {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.log_id === 'string' &&
    UUID.test(v.log_id) &&
    typeof v.occurred_at === 'number' &&
    Number.isFinite(v.occurred_at) &&
    typeof v.platform === 'string' &&
    PLATFORM_VALUES.includes(v.platform) &&
    isRiskLevel(v.risk_level) &&
    typeof v.action === 'string' &&
    ACTIONS.includes(v.action) &&
    Array.isArray(v.categories) &&
    v.categories.length <= 24 &&
    v.categories.every(isCategoryCode) &&
    new Set(v.categories).size === v.categories.length &&
    typeof v.classification_source === 'string' &&
    SOURCES.includes(v.classification_source) &&
    typeof v.user_decision === 'string' &&
    DECISIONS.includes(v.user_decision) &&
    (v.rule_id === null || (typeof v.rule_id === 'string' && UUID.test(v.rule_id))) &&
    v.schema_version === SCHEMA_VERSION
  );
}
