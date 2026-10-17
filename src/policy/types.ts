/**
 * Hares AI — organisational policy (per department) and per-user exceptions.
 *
 * Today the extension runs on DEFAULT_POLICY (src/policy/defaults.ts). Once it
 * is connected to the platform, the backend sends the policy for the signed-in
 * user's department in exactly this shape; the extension stores it
 * (src/policy/store.ts) and every analysis reads it — no code change needed.
 *
 * Every field except `version` and `departmentId` is optional: anything left
 * out falls back to the default policy.
 */

import type { CategoryId, Tier } from '../detectors/categories';

export interface CategoryPolicy {
  /** Tier for this category in this department. SAFE = ignore it entirely. */
  tier?: Tier;
  /** May a user in this department exempt this category on their own device? */
  userOverridable?: boolean;
}

export interface CustomKeyword {
  /** Literal text to find (case-insensitive; not a regex). e.g. "Project Falcon", "مشروع الصقر". */
  text: string;
  /** Category it counts as (decides tier and dashboard grouping). */
  category: CategoryId;
  /** Placeholder label, e.g. CODENAME → [CODENAME_1]. Uppercase letters, digits, _. */
  label: string;
}

export interface Policy {
  /** Monotonic version from the platform; the extension keeps the newest. */
  version: number;
  /** Department the policy belongs to ("default" for the built-in policy). */
  departmentId: string;
  /** Per-category overrides of the built-in tier table. */
  categories?: Partial<Record<CategoryId, CategoryPolicy>>;
  /**
   * Per-type overrides by placeholder label (API_KEY, PASSWORD, EMAIL…), more
   * precise than a category: API_KEY and PASSWORD share AUTH_SECRET.
   * Label beats category beats the built-in table.
   */
  labels?: Record<string, CategoryPolicy>;
  rules?: {
    /** Built-in pattern ids to switch off (see src/detectors/patterns.ts). */
    disabledPatterns?: string[];
    /** Organisation-specific terms (project codenames, client names…). */
    customKeywords?: CustomKeyword[];
  };
  /** Detection model (Phase 3): which model labels are active. */
  detector?: {
    enabledLabels?: string[];
  };
  /** Decision model (Phase 4): its "prompt" — hypotheses or examples per tier. */
  decision?: {
    enabled?: boolean;
    /** Zero-shot hypotheses, one per tier. */
    hypotheses?: Partial<Record<'safe' | 'low' | 'medium' | 'high', string>>;
    /** Example prompts per tier (embedding-similarity models). */
    examples?: Partial<Record<'safe' | 'low' | 'medium' | 'high', string[]>>;
    /** Model score below which the result counts as uncertain. */
    uncertaintyThreshold?: number;
  };
}

/** What a user exempted on their own device (only what the policy marks overridable applies). */
export interface UserExceptions {
  categories: CategoryId[];
  /** Specific types by placeholder label, e.g. ["API_KEY"]. */
  labels?: string[];
  /** ISO time after which the exceptions stop applying. */
  until?: string;
}
