/**
 * Hares AI — the 24 category codes of the backend contract (`enums.ts`).
 *
 * Every category the extension detects is reported to the backend under one of
 * these codes; nothing else may appear in an event. The map is a total
 * `Record`, so adding a category without a code does not compile.
 */

import type { CategoryId } from '../detectors/categories';

export const CATEGORY_CODES = [
  'CONTACT_INFO',
  'PERSONAL_IDENTITY',
  'FINANCIAL_BANKING',
  'AUTH_SECRETS',
  'NETWORK_SYSTEM',
  'WEB_LINKS',
  'LOCATION',
  'HEALTH_MEDICAL',
  'LEGAL_GOVERNMENT',
  'VEHICLE',
  'CORPORATE_DOCUMENTS',
  'FILE_PATH',
  'DIGITAL_FINGERPRINTS',
  'SHIPPING_LOGISTICS',
  'CRYPTO_CERTIFICATES',
  'ACCOUNT_APPLICATION',
  'DATES_TIME',
  'KEYWORD_PATTERNS',
  'LOGS_HEADERS',
  'NUMERIC_SENSITIVE',
  'DEVELOPER_SECRETS',
  'EDUCATION_IDS',
  'UNIVERSAL_IDS',
  'REGION_BANKING_IDENTITY',
] as const;

export type CategoryCode = (typeof CATEGORY_CODES)[number];

/**
 * Internal category → contract code. Saudi national ID/iqama and IBAN are
 * reported as PERSONAL_IDENTITY and FINANCIAL_BANKING, never as
 * REGION_BANKING_IDENTITY (agreed with the backend); that code and
 * UNIVERSAL_IDS have no detector today.
 */
export const CONTRACT_CODE: Readonly<Record<CategoryId, CategoryCode>> = {
  CONTACT: 'CONTACT_INFO',
  PERSONAL_IDENTITY: 'PERSONAL_IDENTITY',
  FINANCIAL: 'FINANCIAL_BANKING',
  AUTH_SECRET: 'AUTH_SECRETS',
  NETWORK: 'NETWORK_SYSTEM',
  WEB_LINK: 'WEB_LINKS',
  LOCATION: 'LOCATION',
  HEALTH: 'HEALTH_MEDICAL',
  LEGAL: 'LEGAL_GOVERNMENT',
  VEHICLE: 'VEHICLE',
  CORPORATE: 'CORPORATE_DOCUMENTS',
  FILE_PATH: 'FILE_PATH',
  FINGERPRINT: 'DIGITAL_FINGERPRINTS',
  SHIPPING: 'SHIPPING_LOGISTICS',
  CRYPTO: 'CRYPTO_CERTIFICATES',
  ACCOUNT: 'ACCOUNT_APPLICATION',
  DATETIME: 'DATES_TIME',
  KEYWORD: 'KEYWORD_PATTERNS',
  LOGS: 'LOGS_HEADERS',
  NUMERIC: 'NUMERIC_SENSITIVE',
  DEV_SECRET: 'DEVELOPER_SECRETS',
  EDUCATION: 'EDUCATION_IDS',
  UNIVERSAL_ID: 'UNIVERSAL_IDS',
  REGIONAL: 'REGION_BANKING_IDENTITY',
};

const CODE_SET: ReadonlySet<string> = new Set(CATEGORY_CODES);

export function toContractCode(category: CategoryId): CategoryCode {
  return CONTRACT_CODE[category];
}

export function isCategoryCode(value: unknown): value is CategoryCode {
  return typeof value === 'string' && CODE_SET.has(value);
}
