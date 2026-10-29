/**
 * Hares AI — the policy bundle from the backend (`GET /policy/bundle`).
 *
 *   { version, policy: [{ category_code, action, enabled, risk_level? } × 24], rules: [...] }
 *
 * `parseBundle` checks the answer strictly: a bundle whose `policy` is not
 * exactly one valid entry per category is rejected whole (the last good one
 * stays in force). Single rules that are malformed are skipped. TOPIC rules are
 * not enforced by the extension and are dropped here.
 *
 * `bundleToPolicy` turns a bundle into the extension's `Policy`:
 *   - enabled = false      → tier SAFE: the category is not detected, enforced or logged
 *   - action BLOCK/WARN/ALLOW → enforcement level HIGH/MEDIUM/LOW
 *   - risk_level           → the risk reported in events (built-in tiers are only
 *                            the fallback when the field is missing)
 */

import { CATEGORY_CODES, CONTRACT_CODE, isCategoryCode, type CategoryCode } from '../contract/categories';
import {
  isPolicyAction,
  isRiskLevel,
  tierFromAction,
  tierFromRisk,
  type PolicyAction,
  type RiskLevel,
} from '../contract/enums';
import type { CategoryId } from '../detectors/categories';
import type { CategoryPolicy, OrgRule, Policy } from './types';

export interface BundleEntry {
  category_code: CategoryCode;
  action: PolicyAction;
  enabled: boolean;
  risk_level?: RiskLevel;
}

export interface ParsedBundle {
  version: number;
  policy: BundleEntry[];
  rules: OrgRule[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEntries(raw: unknown): BundleEntry[] | null {
  if (!Array.isArray(raw) || raw.length !== CATEGORY_CODES.length) return null;
  const seen = new Set<string>();
  const entries: BundleEntry[] = [];
  for (const item of raw) {
    if (
      !isObject(item) ||
      !isCategoryCode(item.category_code) ||
      !isPolicyAction(item.action) ||
      typeof item.enabled !== 'boolean' ||
      seen.has(item.category_code)
    ) {
      return null;
    }
    seen.add(item.category_code);
    entries.push({
      category_code: item.category_code,
      action: item.action,
      enabled: item.enabled,
      // Additive field: absent or unknown values fall back to the built-in tier.
      ...(isRiskLevel(item.risk_level) ? { risk_level: item.risk_level } : {}),
    });
  }
  return entries;
}

function parseRules(raw: unknown): OrgRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: OrgRule[] = [];
  for (const r of raw) {
    if (
      isObject(r) &&
      typeof r.id === 'string' &&
      typeof r.name === 'string' &&
      (r.kind === 'PATTERN' || r.kind === 'KEYWORD') && // TOPIC is not enforced
      typeof r.definition === 'string' &&
      isRiskLevel(r.risk_level) &&
      isPolicyAction(r.action)
    ) {
      rules.push({ id: r.id, name: r.name, kind: r.kind, definition: r.definition, risk: r.risk_level, action: r.action });
    }
  }
  return rules;
}

export function parseBundle(raw: unknown): ParsedBundle | null {
  if (!isObject(raw)) return null;
  const { version } = raw;
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) return null;
  const policy = parseEntries(raw.policy);
  if (!policy) return null;
  return { version, policy, rules: parseRules(raw.rules) };
}

const CATEGORY_OF_CODE: ReadonlyMap<CategoryCode, CategoryId> = new Map(
  (Object.entries(CONTRACT_CODE) as Array<[Exclude<CategoryId, 'ORG_RULE'>, CategoryCode]>).map(([id, code]) => [code, id]),
);

export function bundleToPolicy(bundle: ParsedBundle): Policy {
  const categories: Partial<Record<CategoryId, CategoryPolicy>> = {};
  for (const entry of bundle.policy) {
    const id = CATEGORY_OF_CODE.get(entry.category_code);
    if (!id) continue;
    categories[id] = {
      tier: entry.enabled ? tierFromAction(entry.action) : 'SAFE',
      ...(entry.risk_level ? { risk: tierFromRisk(entry.risk_level) } : {}),
    };
  }
  return { version: bundle.version, departmentId: 'backend', categories, rules: { org: bundle.rules } };
}
