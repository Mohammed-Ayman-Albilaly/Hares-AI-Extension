/**
 * Hares AI — sensitive-data categories and their fixed risk tiers.
 *
 * The 24 categories and the HIGH / MEDIUM / LOW grouping come from the
 * "Sensitive information categories" and "Risk Level" definitions in
 * docs/Hares AI.pdf (§6). Categories the PDF lists but does not assign to a
 * tier are mapped here explicitly and marked `// not in PDF tier list`.
 */

export const TIERS = ['SAFE', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type Tier = (typeof TIERS)[number];

/** Numeric rank for comparing tiers (`max` of two tiers). */
export const TIER_RANK: Record<Tier, number> = { SAFE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

export function maxTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

export const CATEGORIES = {
  CONTACT: { name: 'Contact Information', tier: 'MEDIUM' },
  PERSONAL_IDENTITY: { name: 'Personal Identity Data', tier: 'HIGH' },
  FINANCIAL: { name: 'Financial & Banking Data', tier: 'HIGH' },
  AUTH_SECRET: { name: 'Authentication & Security Secrets', tier: 'HIGH' },
  NETWORK: { name: 'Network & System Data', tier: 'MEDIUM' },
  WEB_LINK: { name: 'Web Links & Identifiers', tier: 'MEDIUM' },
  LOCATION: { name: 'Location Data', tier: 'MEDIUM' },
  HEALTH: { name: 'Health / Medical Data', tier: 'HIGH' }, // not in PDF tier list
  LEGAL: { name: 'Legal & Government Data', tier: 'MEDIUM' },
  VEHICLE: { name: 'Vehicle Data', tier: 'MEDIUM' },
  CORPORATE: { name: 'Corporate & Document Identifiers', tier: 'MEDIUM' },
  FILE_PATH: { name: 'File & Path Data', tier: 'MEDIUM' },
  FINGERPRINT: { name: 'Digital Fingerprints & Technical Identifiers', tier: 'MEDIUM' },
  SHIPPING: { name: 'Shipping & Logistics Data', tier: 'MEDIUM' },
  CRYPTO: { name: 'Cryptography & Certificates', tier: 'HIGH' },
  ACCOUNT: { name: 'Account & Application Data', tier: 'MEDIUM' }, // not in PDF tier list
  DATETIME: { name: 'Dates & Time Data', tier: 'MEDIUM' },
  KEYWORD: { name: 'Keyword-Based Sensitive Patterns', tier: 'LOW' },
  LOGS: { name: 'Logs & Headers Data', tier: 'MEDIUM' },
  NUMERIC: { name: 'Numeric Sensitive Data', tier: 'MEDIUM' },
  DEV_SECRET: { name: 'Developer & Code Secrets', tier: 'HIGH' },
  EDUCATION: { name: 'Education-Related Identifiers', tier: 'MEDIUM' },
  UNIVERSAL_ID: { name: 'Universal Identifiers', tier: 'LOW' }, // not in PDF tier list
  REGIONAL: { name: 'Region-Specific Banking & Identity Data', tier: 'HIGH' }, // not in PDF tier list
  // Internal: a match of an organisation rule from the policy bundle. It has
  // no contract code, so it never appears in an event's `categories`.
  ORG_RULE: { name: 'Organisation rule', tier: 'MEDIUM' },
} as const satisfies Record<string, { name: string; tier: Tier }>;

export type CategoryId = keyof typeof CATEGORIES;

/**
 * Types whose built-in tier is lower than their category's. A person's name is
 * reported under PERSONAL_IDENTITY (the backend has no separate code for it)
 * but a name alone must not be blocked like a national ID number.
 */
const LABEL_TIER_DEFAULTS: Readonly<Record<string, Tier>> = {
  PERSON: 'MEDIUM',
  AGE: 'MEDIUM',
};

/** Built-in tier of one detected type, before any policy is applied (a rule match carries its own). */
export function builtInTier(d: { category: CategoryId; label: string; rule?: { enforce: Tier } }): Tier {
  if (d.rule) return d.rule.enforce;
  return LABEL_TIER_DEFAULTS[d.label] ?? CATEGORIES[d.category].tier;
}

export function categoryTier(category: CategoryId): Tier {
  return CATEGORIES[category].tier;
}

/**
 * Categories whose detections are reported but never replaced with a
 * placeholder: masking the word "password" itself protects nothing.
 */
export const UNMASKED_CATEGORIES: ReadonlySet<CategoryId> = new Set(['KEYWORD']);
