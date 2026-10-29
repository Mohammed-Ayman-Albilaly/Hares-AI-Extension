/**
 * Hares AI — detection-model labels → our categories and placeholder labels.
 *
 * Model: Horizon-Labs/pii-redactor-small (29 entity types, BIO tags).
 *
 * `enabled: false` marks types that are too common to flag on their
 * own (a city name, a company name, a plain date): flagging them would open a
 * dialog on ordinary prompts. A department policy can switch them on
 * (`detector.enabledLabels`).
 */

import type { CategoryId } from '../detectors/categories';

export interface ModelLabelMapping {
  category: CategoryId;
  /** Placeholder label → `[PERSON_1]`. Shared with the rules where the type is the same. */
  label: string;
  /** Off for types too common to flag on their own; fixed, not configurable by policy. */
  enabled: boolean;
}

export const MODEL_LABELS: Record<string, ModelLabelMapping> = {
  PERSON: { category: 'PERSONAL_IDENTITY', label: 'PERSON', enabled: true },
  STREET_ADDRESS: { category: 'LOCATION', label: 'ADDRESS', enabled: true },
  COORDINATE: { category: 'LOCATION', label: 'GPS', enabled: true },
  USERNAME: { category: 'ACCOUNT', label: 'USERNAME', enabled: true },
  ACCOUNT_ID: { category: 'ACCOUNT', label: 'ACCOUNT_ID', enabled: true },
  PASSWORD: { category: 'AUTH_SECRET', label: 'PASSWORD', enabled: true },
  SECRET: { category: 'AUTH_SECRET', label: 'SECRET', enabled: true },
  EMAIL: { category: 'CONTACT', label: 'EMAIL', enabled: true },
  PHONE: { category: 'CONTACT', label: 'PHONE', enabled: true },
  NATIONAL_ID: { category: 'PERSONAL_IDENTITY', label: 'NATIONAL_ID', enabled: true },
  PASSPORT: { category: 'PERSONAL_IDENTITY', label: 'PASSPORT', enabled: true },
  DRIVER_LICENSE: { category: 'PERSONAL_IDENTITY', label: 'ID_NUMBER', enabled: true },
  CREDIT_CARD: { category: 'FINANCIAL', label: 'CARD_NUMBER', enabled: true },
  CREDIT_CARD_CVV: { category: 'FINANCIAL', label: 'CVV', enabled: true },
  BANK_ACCOUNT: { category: 'FINANCIAL', label: 'BANK_ACCOUNT', enabled: true },
  TAX_ID: { category: 'CORPORATE', label: 'TAX_ID', enabled: true },
  MEDICAL_ID: { category: 'HEALTH', label: 'MEDICAL_RECORD', enabled: true },
  DATE_OF_BIRTH: { category: 'DATETIME', label: 'DATE_OF_BIRTH', enabled: true },
  IP_ADDRESS: { category: 'NETWORK', label: 'IP_ADDRESS', enabled: true },
  MAC_ADDRESS: { category: 'NETWORK', label: 'MAC_ADDRESS', enabled: true },
  DEVICE_ID: { category: 'FINGERPRINT', label: 'DEVICE_ID', enabled: true },
  VEHICLE_ID: { category: 'VEHICLE', label: 'VIN', enabled: true },
  LICENSE_NUMBER: { category: 'LEGAL', label: 'LICENSE_NUMBER', enabled: true },
  // Too common on their own — always off.
  LOCATION: { category: 'LOCATION', label: 'LOCATION', enabled: false },
  ORGANIZATION: { category: 'CORPORATE', label: 'ORGANIZATION', enabled: false },
  DATE: { category: 'DATETIME', label: 'DATE', enabled: false },
  AGE: { category: 'PERSONAL_IDENTITY', label: 'AGE', enabled: false },
  POSTCODE: { category: 'LOCATION', label: 'POSTCODE', enabled: false },
  URL: { category: 'WEB_LINK', label: 'URL', enabled: false }, // the rules already cover URLs
};

/** Model types that produce detections. */
export const ENABLED_MODEL_LABELS: ReadonlySet<string> = new Set(
  Object.entries(MODEL_LABELS).filter(([, m]) => m.enabled).map(([k]) => k),
);
