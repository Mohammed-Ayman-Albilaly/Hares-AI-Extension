/**
 * Hares AI — enum values of the backend contract that the extension uses, and
 * the conversions between them and the extension's own tiers.
 */

import type { Tier } from '../detectors/categories';

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type PolicyAction = 'ALLOW' | 'WARN' | 'BLOCK';
export type LogAction = 'BLOCKED' | 'WARNED' | 'ALLOWED';

export const RISK_LEVELS: readonly RiskLevel[] = ['HIGH', 'MEDIUM', 'LOW', 'NONE'];
export const POLICY_ACTIONS: readonly PolicyAction[] = ['ALLOW', 'WARN', 'BLOCK'];

export function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === 'string' && (RISK_LEVELS as readonly string[]).includes(v);
}

export function isPolicyAction(v: unknown): v is PolicyAction {
  return typeof v === 'string' && (POLICY_ACTIONS as readonly string[]).includes(v);
}

/** The backend's NONE is the extension's SAFE. */
export function tierFromRisk(risk: RiskLevel): Tier {
  return risk === 'NONE' ? 'SAFE' : risk;
}

export function riskFromTier(tier: Tier): RiskLevel {
  return tier === 'SAFE' ? 'NONE' : tier;
}

/**
 * The enforcement level a policy action stands for: BLOCK shows the block
 * dialog (HIGH), WARN the confirm dialog (MEDIUM), ALLOW sends with a notice
 * (LOW).
 */
export function tierFromAction(action: PolicyAction): Tier {
  return action === 'BLOCK' ? 'HIGH' : action === 'WARN' ? 'MEDIUM' : 'LOW';
}

/** The action an enforcement level is logged as. */
export function logActionFromTier(tier: Tier): LogAction {
  return tier === 'HIGH' ? 'BLOCKED' : tier === 'MEDIUM' ? 'WARNED' : 'ALLOWED';
}
