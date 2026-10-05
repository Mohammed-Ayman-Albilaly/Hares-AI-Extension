/**
 * Hares AI — rule-detector pattern table.
 *
 * Plain, serializable data (regex source strings, not RegExp objects) so the
 * table can later be fetched/updated without redeploying the extension
 * (docs/Hares AI.pdf 6.2.5.1). `group` masks only a capture group (the value
 * after a keyword such as `password:`), and `validate` names a checksum in
 * src/detectors/validators.ts that a match must pass.
 *
 * Note: JS `\b` only understands ASCII word characters, so Arabic keywords are
 * written without word boundaries.
 */

import type { CategoryId } from './categories';
import type { ValidatorName } from './validators';

export interface PatternSpec {
  id: string;
  category: CategoryId;
  label: string;
  source: string;
  /** Extra regex flags; `g` and `d` are always added. */
  flags?: string;
  /** Capture group holding the sensitive value (default: whole match). */
  group?: number;
  validate?: ValidatorName;
}

const r = String.raw;

/**
 * `<keyword> [:#=]? <value>` — keyword-anchored value in capture group 1.
 * With `requireSeparator`, the `is` / `=` / `:` is mandatory, so free text such
 * as "password reset link" does not capture "reset".
 */
function anchored(keywords: string, value: string, requireSeparator = false): string {
  const sep = requireSeparator ? r`\s*(?:is|=|:)\s*` : r`\s*(?:is|=|:|#|-)?\s*`;
  return r`(?:${keywords})${sep}["']?(${value})`;
}

/** Password keywords, English + Arabic (incl. Gulf "باسورد" spellings). */
const PASSWORD_KEYWORDS = r`password|passwd|pwd|passcode|pass\s*phrase|كلمة\s*(?:ال)?(?:مرور|سر)|(?:ال)?باسو?ورد|(?:ال)?رمز\s*السري`;
const PASSWORD_VALUE = r`[^\s"',;]{4,}`;
/** Up to three words between the keyword and the separator: "password for gmail is", "الباسورد حقي :". */
const FILLER = r`(?:\s+[^\s:=]{1,20}){1,3}`;

/** Alphanumeric identifier that must contain at least one digit (rejects plain words). */
function idWithDigit(length: string): string {
  return r`(?=[A-Za-z-]*\d)[A-Z0-9-]${length}`;
}

export const PATTERNS: readonly PatternSpec[] = [
  // --- Cryptography & Certificates (HIGH) ---------------------------------
  {
    id: 'private-key',
    category: 'CRYPTO',
    label: 'PRIVATE_KEY',
    source: r`-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )*PRIVATE KEY-----|$)`,
  },
  {
    id: 'certificate',
    category: 'CRYPTO',
    label: 'CERTIFICATE',
    source: r`-----BEGIN (?:CERTIFICATE|CERTIFICATE REQUEST|PUBLIC KEY|PGP [A-Z ]+)-----[\s\S]*?-----END [A-Z ]+-----`,
  },
  {
    id: 'ssh-key',
    category: 'CRYPTO',
    label: 'SSH_KEY',
    source: r`\bssh-(?:rsa|ed25519|dss|ecdsa-[a-z0-9-]+) [A-Za-z0-9+/=]{40,}`,
  },

  // --- Developer & Code Secrets (HIGH) ------------------------------------
  {
    id: 'connection-string',
    category: 'DEV_SECRET',
    label: 'CONNECTION_STRING',
    source: r`\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|rediss|amqp|mssql|sqlserver):\/\/[^\s"'<>]+`,
    flags: 'i',
  },
  {
    id: 'github-token',
    category: 'DEV_SECRET',
    label: 'GITHUB_TOKEN',
    source: r`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b`,
  },
  { id: 'npm-token', category: 'DEV_SECRET', label: 'NPM_TOKEN', source: r`\bnpm_[A-Za-z0-9]{36}\b` },
  {
    id: 'env-secret',
    category: 'DEV_SECRET',
    label: 'ENV_SECRET',
    source: r`\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*["']?([^\s"']{8,})`,
    group: 1,
  },

  // --- Authentication & Security Secrets (HIGH) ---------------------------
  {
    id: 'jwt',
    category: 'AUTH_SECRET',
    label: 'JWT',
    source: r`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
    validate: 'jwt',
  },
  {
    id: 'openai-anthropic-key',
    category: 'AUTH_SECRET',
    label: 'API_KEY',
    source: r`\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}`,
  },
  { id: 'aws-access-key', category: 'AUTH_SECRET', label: 'API_KEY', source: r`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b` },
  { id: 'google-api-key', category: 'AUTH_SECRET', label: 'API_KEY', source: r`\bAIza[0-9A-Za-z_-]{35}` },
  { id: 'slack-token', category: 'AUTH_SECRET', label: 'API_KEY', source: r`\bxox[abprs]-[A-Za-z0-9-]{10,}` },
  { id: 'stripe-key', category: 'AUTH_SECRET', label: 'API_KEY', source: r`\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}` },
  {
    id: 'generic-api-key',
    category: 'AUTH_SECRET',
    label: 'API_KEY',
    source: r`(?:api[_-]?key|api[_-]?secret|access[_-]?token|client[_-]?secret|secret[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9\-_.+/=]{12,})`,
    flags: 'i',
    group: 1,
    validate: 'highEntropy',
  },
  {
    id: 'bearer-token',
    category: 'AUTH_SECRET',
    label: 'BEARER_TOKEN',
    source: r`\bbearer\s+([A-Za-z0-9\-._~+/]{16,}=*)`,
    flags: 'i',
    group: 1,
  },
  {
    id: 'auth-header',
    category: 'AUTH_SECRET',
    label: 'AUTH_HEADER',
    source: r`\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key)\s*:\s*([^\r\n]{8,})`,
    flags: 'i',
    group: 1,
  },
  {
    id: 'password',
    category: 'AUTH_SECRET',
    label: 'PASSWORD',
    // "password: x", "password is x", "الباسورد هو x"
    source: r`(?:${PASSWORD_KEYWORDS})\s*(?:is|=|:|هو|هي)\s*["']?(${PASSWORD_VALUE})`,
    flags: 'i',
    group: 1,
  },
  {
    id: 'password-filler-colon',
    category: 'AUTH_SECRET',
    label: 'PASSWORD',
    // "الباسورد حقي : x", "password for my gmail: x" — a colon / = is a strong signal.
    source: r`(?:${PASSWORD_KEYWORDS})${FILLER}\s*[:=]\s*["']?(${PASSWORD_VALUE})`,
    flags: 'i',
    group: 1,
  },
  {
    id: 'password-filler-is',
    category: 'AUTH_SECRET',
    label: 'PASSWORD',
    // "my password for gmail is Hunter2" — weaker signal, so the value must look like a password
    // ("password reset is broken" must not match).
    source: r`(?:${PASSWORD_KEYWORDS})${FILLER}\s+(?:is|هو|هي)\s*["']?(${PASSWORD_VALUE})`,
    flags: 'i',
    group: 1,
    validate: 'passwordLike',
  },
  {
    id: 'pin-otp',
    category: 'AUTH_SECRET',
    label: 'PIN',
    // Up to two non-digit words may sit between keyword and code: "الرقم السري للبطاقة 4821", "OTP code for login: 4829".
    source: r`(?:\bpin(?:\s*code)?|\botp|verification\s*code|رمز\s*(?:التحقق|التفعيل)|الرقم\s*السري)(?:\s+[^\s\d:=]{1,20}){0,2}\s*(?:is|=|:|#|-|هو)?\s*["']?(\d{4,8})\b`,
    flags: 'i',
    group: 1,
  },

  // --- Financial & Banking (HIGH) -----------------------------------------
  { id: 'iban', category: 'FINANCIAL', label: 'IBAN', source: r`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b`, validate: 'iban' },
  { id: 'credit-card', category: 'FINANCIAL', label: 'CARD_NUMBER', source: r`\b\d(?:[ -]?\d){12,18}\b`, validate: 'card' },
  {
    id: 'cvv',
    category: 'FINANCIAL',
    label: 'CVV',
    source: anchored(r`\bcvv2?|\bcvc2?|\bcsc|رمز\s*الأمان`, r`\d{3,4}`),
    flags: 'i',
    group: 1,
  },
  {
    id: 'swift',
    category: 'FINANCIAL',
    label: 'SWIFT',
    source: anchored(r`\bswift(?:\s*code)?|\bbic`, r`[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?`),
    flags: 'i',
    group: 1,
  },
  {
    id: 'bank-account',
    category: 'FINANCIAL',
    label: 'BANK_ACCOUNT',
    source: anchored(r`(?:bank\s*)?account\s*(?:no|number|#)|رقم\s*الحساب`, r`\d{8,20}`),
    flags: 'i',
    group: 1,
  },

  // --- Personal Identity (HIGH) -------------------------------------------
  { id: 'saudi-id', category: 'PERSONAL_IDENTITY', label: 'NATIONAL_ID', source: r`\b[12]\d{9}\b`, validate: 'saudiId' },
  {
    id: 'passport',
    category: 'PERSONAL_IDENTITY',
    label: 'PASSPORT',
    source: anchored(r`passport(?:\s*(?:no|number|#))?|رقم\s*الجواز|جواز\s*السفر`, r`[A-Z]{1,2}\d{6,8}`),
    flags: 'i',
    group: 1,
  },
  {
    id: 'ssn',
    category: 'PERSONAL_IDENTITY',
    label: 'SSN',
    source: r`\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b`,
  },
  {
    id: 'license-id',
    category: 'PERSONAL_IDENTITY',
    label: 'ID_NUMBER',
    source: anchored(r`driver'?s?\s*licen[cs]e(?:\s*(?:no|number))?|employee\s*id|insurance\s*id|رقم\s*الهوية|رقم\s*الإقامة`, idWithDigit("{6,15}")),
    flags: 'i',
    group: 1,
  },

  // --- Health / Medical ----------------------------------------------------
  {
    id: 'mrn',
    category: 'HEALTH',
    label: 'MEDICAL_RECORD',
    source: anchored(r`\bmrn|medical\s*record(?:\s*(?:no|number))?|رقم\s*الملف\s*الطبي`, idWithDigit("{5,15}")),
    flags: 'i',
    group: 1,
  },
  {
    id: 'icd',
    category: 'HEALTH',
    label: 'DIAGNOSIS_CODE',
    source: anchored(r`\bicd(?:-?1[01])?(?:\s*code)?|diagnosis\s*code`, r`[A-TV-Z]\d{2}(?:\.\d{1,4})?`),
    flags: 'i',
    group: 1,
  },

  // --- Contact (MEDIUM) ----------------------------------------------------
  { id: 'email', category: 'CONTACT', label: 'EMAIL', source: r`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` },
  { id: 'saudi-mobile', category: 'CONTACT', label: 'PHONE', source: r`(?:\+966|00966|\b0)5\d(?:[ -]?\d){7}\b` },
  {
    id: 'intl-phone',
    category: 'CONTACT',
    label: 'PHONE',
    source: r`\+\d{1,3}[ -]?\(?\d{1,4}\)?(?:[ -]?\d{2,4}){2,4}\b`,
    validate: 'phone',
  },

  // --- Network & System (MEDIUM) ------------------------------------------
  {
    id: 'ipv4',
    category: 'NETWORK',
    label: 'IP_ADDRESS',
    source: r`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\/\d{1,2})?\b`,
  },
  {
    id: 'ipv6',
    category: 'NETWORK',
    label: 'IP_ADDRESS',
    source: r`\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?`,
    flags: 'i',
    validate: 'ipv6',
  },
  { id: 'mac', category: 'NETWORK', label: 'MAC_ADDRESS', source: r`\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b` },

  // --- Web Links (MEDIUM) --------------------------------------------------
  { id: 'url', category: 'WEB_LINK', label: 'URL', source: r`\bhttps?:\/\/[^\s<>"'()]+`, flags: 'i' },

  // --- Location (MEDIUM) ---------------------------------------------------
  { id: 'gps', category: 'LOCATION', label: 'GPS', source: r`-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}`, validate: 'gps' },

  // --- Vehicle (MEDIUM) ----------------------------------------------------
  { id: 'vin', category: 'VEHICLE', label: 'VIN', source: r`\b[A-HJ-NPR-Z0-9]{17}\b`, validate: 'vin' },

  // --- Corporate & Document (MEDIUM) --------------------------------------
  { id: 'saudi-vat', category: 'CORPORATE', label: 'VAT_NUMBER', source: r`\b3\d{13}3\b` },
  {
    id: 'commercial-registration',
    category: 'CORPORATE',
    label: 'CR_NUMBER',
    source: anchored(r`\bcr(?:\s*(?:no|number))?|commercial\s*registration|السجل\s*التجاري`, r`\d{10}`),
    flags: 'i',
    group: 1,
  },

  // --- File & Path (MEDIUM) ------------------------------------------------
  {
    id: 'windows-path',
    category: 'FILE_PATH',
    label: 'FILE_PATH',
    source: r`\b[A-Za-z]:\\(?:[^\\\s:*?"<>|]+\\)*[^\\\s:*?"<>|]*`,
  },
  {
    id: 'unix-path',
    category: 'FILE_PATH',
    label: 'FILE_PATH',
    source: r`(?:^|[\s"'(=])(\/(?:etc|home|usr|var|opt|root|Users|srv|mnt|tmp)\/[^\s"'<>)]*)`,
    group: 1,
  },
  {
    id: 'secret-file',
    category: 'FILE_PATH',
    label: 'SECRET_FILE',
    source: r`(?:^|[\s/\\"'])(\.env(?:\.[\w.-]+)?|id_rsa|id_ed25519|credentials\.json|\.npmrc|\.pgpass|\.netrc)(?![\w.-])`,
    group: 1,
  },

  // --- Digital Fingerprints (MEDIUM) --------------------------------------
  {
    id: 'uuid',
    category: 'FINGERPRINT',
    label: 'UUID',
    source: r`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`,
    flags: 'i',
  },
  { id: 'hash', category: 'FINGERPRINT', label: 'HASH', source: r`\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b`, flags: 'i' },
  { id: 'imei', category: 'FINGERPRINT', label: 'IMEI', source: anchored(r`\bimei`, r`\d{15}`), flags: 'i', group: 1, validate: 'luhn' },

  // --- Shipping & Logistics (MEDIUM) --------------------------------------
  {
    id: 'tracking',
    category: 'SHIPPING',
    label: 'TRACKING_NUMBER',
    source: anchored(r`tracking\s*(?:no|number|#)?|order\s*(?:id|no|number|#)|رقم\s*(?:الطلب|الشحنة|التتبع)`, idWithDigit("{6,25}")),
    flags: 'i',
    group: 1,
  },

  // --- Account & Application ----------------------------------------------
  {
    id: 'account-id',
    category: 'ACCOUNT',
    label: 'ACCOUNT_ID',
    source: anchored(r`customer\s*(?:id|no|number)|member(?:ship)?\s*(?:id|no|number)|subscription\s*id|licen[cs]e\s*key|activation\s*code|رقم\s*العميل`, idWithDigit("{6,30}")),
    flags: 'i',
    group: 1,
  },

  // --- Dates & Time (MEDIUM) ----------------------------------------------
  {
    id: 'date-of-birth',
    category: 'DATETIME',
    label: 'DATE_OF_BIRTH',
    source: anchored(r`\bdob|date\s*of\s*birth|birth\s*date|تاريخ\s*(?:ال)?ميلاد`, r`\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}`),
    flags: 'i',
    group: 1,
  },

  // --- Logs & Headers (MEDIUM) --------------------------------------------
  { id: 'user-agent', category: 'LOGS', label: 'USER_AGENT', source: r`Mozilla\/5\.0 \([^)]+\)[^\r\n]*` },

  // --- Education (MEDIUM) --------------------------------------------------
  {
    id: 'student-id',
    category: 'EDUCATION',
    label: 'STUDENT_ID',
    source: anchored(r`student\s*(?:id|no|number)|university\s*id|الرقم\s*الجامعي`, r`\d{6,12}`),
    flags: 'i',
    group: 1,
  },

  // --- Numeric (MEDIUM) — catch-all, loses ties to every specific pattern --
  { id: 'long-number', category: 'NUMERIC', label: 'NUMBER', source: r`\b\d{9,}\b` },

  // --- Keyword-based (LOW) — reported, never masked -----------------------
  {
    id: 'keyword',
    category: 'KEYWORD',
    label: 'KEYWORD',
    source: r`\b(?:password|passwd|secret|token|api[_-]?key|authorization|ssn|dob|confidential|credentials)\b|كلمة\s*(?:ال)?(?:مرور|سر)|(?:ال)?باسو?ورد|الرقم\s*السري|(?:ال)?مفتاح\s*(?:ال)?سري|(?:ال)?توكن|سري\s*للغاية|(?:معلومات|بيانات)\s*سرية`,
    flags: 'i',
  },
];
