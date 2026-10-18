/**
 * Hares AI — detection-model labels → our categories and placeholder labels.
 *
 * Model: Horizon-Labs/pii-redactor-small (29 entity types, BIO tags).
 *
 * `enabledByDefault: false` marks types that are too common to flag on their
 * own (a city name, a company name, a plain date): flagging them would open a
 * dialog on ordinary prompts. A department policy can switch them on
 * (`detector.enabledLabels`).
 */

import type { CategoryId } from '../detectors/categories';

export interface ModelLabelMapping {
  category: CategoryId;
  /** Placeholder label → `[PERSON_1]`. Shared with the rules where the type is the same. */
  label: string;
  enabledByDefault: boolean;
}

export const MODEL_LABELS: Record<string, ModelLabelMapping> = {
  PERSON: { category: 'PERSONAL_NAME', label: 'PERSON', enabledByDefault: true },
  STREET_ADDRESS: { category: 'LOCATION', label: 'ADDRESS', enabledByDefault: true },
  COORDINATE: { category: 'LOCATION', label: 'GPS', enabledByDefault: true },
  USERNAME: { category: 'ACCOUNT', label: 'USERNAME', enabledByDefault: true },
  ACCOUNT_ID: { category: 'ACCOUNT', label: 'ACCOUNT_ID', enabledByDefault: true },
  PASSWORD: { category: 'AUTH_SECRET', label: 'PASSWORD', enabledByDefault: true },
  SECRET: { category: 'AUTH_SECRET', label: 'SECRET', enabledByDefault: true },
  EMAIL: { category: 'CONTACT', label: 'EMAIL', enabledByDefault: true },
  PHONE: { category: 'CONTACT', label: 'PHONE', enabledByDefault: true },
  NATIONAL_ID: { category: 'PERSONAL_IDENTITY', label: 'NATIONAL_ID', enabledByDefault: true },
  PASSPORT: { category: 'PERSONAL_IDENTITY', label: 'PASSPORT', enabledByDefault: true },
  DRIVER_LICENSE: { category: 'PERSONAL_IDENTITY', label: 'ID_NUMBER', enabledByDefault: true },
  CREDIT_CARD: { category: 'FINANCIAL', label: 'CARD_NUMBER', enabledByDefault: true },
  CREDIT_CARD_CVV: { category: 'FINANCIAL', label: 'CVV', enabledByDefault: true },
  BANK_ACCOUNT: { category: 'FINANCIAL', label: 'BANK_ACCOUNT', enabledByDefault: true },
  TAX_ID: { category: 'CORPORATE', label: 'TAX_ID', enabledByDefault: true },
  MEDICAL_ID: { category: 'HEALTH', label: 'MEDICAL_RECORD', enabledByDefault: true },
  DATE_OF_BIRTH: { category: 'DATETIME', label: 'DATE_OF_BIRTH', enabledByDefault: true },
  IP_ADDRESS: { category: 'NETWORK', label: 'IP_ADDRESS', enabledByDefault: true },
  MAC_ADDRESS: { category: 'NETWORK', label: 'MAC_ADDRESS', enabledByDefault: true },
  DEVICE_ID: { category: 'FINGERPRINT', label: 'DEVICE_ID', enabledByDefault: true },
  VEHICLE_ID: { category: 'VEHICLE', label: 'VIN', enabledByDefault: true },
  LICENSE_NUMBER: { category: 'LEGAL', label: 'LICENSE_NUMBER', enabledByDefault: true },
  // Too common on their own — off unless a policy enables them.
  LOCATION: { category: 'LOCATION', label: 'LOCATION', enabledByDefault: false },
  ORGANIZATION: { category: 'CORPORATE', label: 'ORGANIZATION', enabledByDefault: false },
  DATE: { category: 'DATETIME', label: 'DATE', enabledByDefault: false },
  AGE: { category: 'PERSONAL_NAME', label: 'AGE', enabledByDefault: false },
  POSTCODE: { category: 'LOCATION', label: 'POSTCODE', enabledByDefault: false },
  URL: { category: 'WEB_LINK', label: 'URL', enabledByDefault: false }, // the rules already cover URLs
};

/** Model types that produce detections under a policy's `detector.enabledLabels`. */
export function enabledModelLabels(enabledLabels?: readonly string[]): ReadonlySet<string> {
  if (enabledLabels && enabledLabels.length > 0) return new Set(enabledLabels);
  return new Set(Object.entries(MODEL_LABELS).filter(([, m]) => m.enabledByDefault).map(([k]) => k));
}
