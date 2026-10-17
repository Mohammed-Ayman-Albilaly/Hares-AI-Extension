/**
 * Hares AI — validate a policy received from storage / the platform.
 *
 * A policy is data from outside the extension, so it is checked field by field
 * and anything malformed is dropped (never thrown on), keeping the rest. A
 * policy that fails the basic shape is rejected and the previous one is kept.
 *
 * Custom keywords are literal text (escaped before matching), never raw regex:
 * a malformed or slow pattern from a policy could freeze the user's browser.
 */

import { CATEGORIES, TIERS, type CategoryId, type Tier } from '../detectors/categories';
import type { CategoryPolicy, CustomKeyword, Policy } from './types';

export const LIMITS = {
  customKeywords: 200,
  keywordLength: 80,
  disabledPatterns: 200,
  hypothesisLength: 300,
  examplesPerTier: 50,
  exampleLength: 500,
} as const;

const LABEL_RE = /^[A-Z][A-Z0-9_]{1,30}$/;
const HYPOTHESIS_KEYS = ['safe', 'low', 'medium', 'high'] as const;

export interface ValidationResult {
  policy: Policy | null;
  /** Human-readable notes about dropped fields (for logs / the admin preview). */
  warnings: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCategory(v: unknown): v is CategoryId {
  return typeof v === 'string' && v in CATEGORIES;
}

function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

function strings(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= maxLen).slice(0, max);
}

export function validatePolicy(input: unknown): ValidationResult {
  const warnings: string[] = [];
  if (!isObject(input)) return { policy: null, warnings: ['policy is not an object'] };
  const { version, departmentId } = input;
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 0) {
    return { policy: null, warnings: ['policy.version must be a non-negative number'] };
  }
  if (typeof departmentId !== 'string' || departmentId.length === 0 || departmentId.length > 100) {
    return { policy: null, warnings: ['policy.departmentId must be a non-empty string'] };
  }

  const policy: Policy = { version, departmentId };

  if (isObject(input.categories)) {
    const categories: Partial<Record<CategoryId, CategoryPolicy>> = {};
    for (const [key, value] of Object.entries(input.categories)) {
      if (!isCategory(key) || !isObject(value)) {
        warnings.push(`categories.${key}: unknown category or bad value, ignored`);
        continue;
      }
      const entry: CategoryPolicy = {};
      if (value.tier !== undefined) {
        if (isTier(value.tier)) entry.tier = value.tier;
        else warnings.push(`categories.${key}.tier: invalid, ignored`);
      }
      if (typeof value.userOverridable === 'boolean') entry.userOverridable = value.userOverridable;
      categories[key] = entry;
    }
    policy.categories = categories;
  }

  if (isObject(input.labels)) {
    const labels: Record<string, CategoryPolicy> = {};
    for (const [key, value] of Object.entries(input.labels)) {
      if (!LABEL_RE.test(key) || !isObject(value)) {
        warnings.push(`labels.${key}: bad label or value, ignored`);
        continue;
      }
      const entry: CategoryPolicy = {};
      if (value.tier !== undefined) {
        if (isTier(value.tier)) entry.tier = value.tier;
        else warnings.push(`labels.${key}.tier: invalid, ignored`);
      }
      if (typeof value.userOverridable === 'boolean') entry.userOverridable = value.userOverridable;
      labels[key] = entry;
    }
    policy.labels = labels;
  }

  if (isObject(input.rules)) {
    const keywords: CustomKeyword[] = [];
    const rawKeywords = Array.isArray(input.rules.customKeywords) ? input.rules.customKeywords : [];
    for (const k of rawKeywords.slice(0, LIMITS.customKeywords)) {
      if (
        isObject(k) &&
        typeof k.text === 'string' &&
        k.text.trim().length >= 2 &&
        k.text.length <= LIMITS.keywordLength &&
        isCategory(k.category) &&
        typeof k.label === 'string' &&
        LABEL_RE.test(k.label)
      ) {
        keywords.push({ text: k.text.trim(), category: k.category, label: k.label });
      } else {
        warnings.push('rules.customKeywords: malformed entry ignored');
      }
    }
    policy.rules = {
      disabledPatterns: strings(input.rules.disabledPatterns, LIMITS.disabledPatterns, 60),
      customKeywords: keywords,
    };
  }

  if (isObject(input.detector)) {
    policy.detector = { enabledLabels: strings(input.detector.enabledLabels, 100, 40) };
  }

  if (isObject(input.decision)) {
    const d = input.decision;
    const decision: NonNullable<Policy['decision']> = {};
    if (typeof d.enabled === 'boolean') decision.enabled = d.enabled;
    if (typeof d.uncertaintyThreshold === 'number' && d.uncertaintyThreshold >= 0 && d.uncertaintyThreshold <= 1) {
      decision.uncertaintyThreshold = d.uncertaintyThreshold;
    }
    if (isObject(d.hypotheses)) {
      const hypotheses: NonNullable<typeof decision.hypotheses> = {};
      for (const key of HYPOTHESIS_KEYS) {
        const h = d.hypotheses[key];
        if (typeof h === 'string' && h.length > 0 && h.length <= LIMITS.hypothesisLength) hypotheses[key] = h;
      }
      decision.hypotheses = hypotheses;
    }
    if (isObject(d.examples)) {
      const examples: NonNullable<typeof decision.examples> = {};
      for (const key of HYPOTHESIS_KEYS) {
        const list = strings(d.examples[key], LIMITS.examplesPerTier, LIMITS.exampleLength);
        if (list.length) examples[key] = list;
      }
      decision.examples = examples;
    }
    policy.decision = decision;
  }

  return { policy, warnings };
}
