/**
 * Hares AI — checksum / structure validators used by the rule detectors to
 * reject regex matches that only look like sensitive data.
 *
 * Validators are referenced by name from src/detectors/patterns.ts so the
 * pattern table stays plain data.
 */

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Luhn (mod 10) — card numbers, IMEI, Saudi national ID / iqama. */
export function luhn(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length < 2) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Card number: 13–19 digits passing Luhn, not a single repeated digit. */
export function card(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length < 13 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  return luhn(digits);
}

/** Saudi national ID (starts with 1) or iqama (starts with 2): 10 digits + Luhn. */
export function saudiId(value: string): boolean {
  const digits = digitsOf(value);
  return /^[12]\d{9}$/.test(digits) && luhn(digits);
}

const IBAN_LENGTHS: Record<string, number> = {
  SA: 24, AE: 23, BH: 22, KW: 30, QA: 29, JO: 30, EG: 29, GB: 22, DE: 22, FR: 27,
};

/** IBAN: ISO 13616 mod-97 check (with known per-country lengths). */
export function iban(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const expected = IBAN_LENGTHS[compact.slice(0, 2)];
  if (expected !== undefined && compact.length !== expected) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function base64UrlDecode(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

/** JWT: header segment decodes to JSON with an `alg` field. */
export function jwt(value: string): boolean {
  const [header] = value.split('.');
  if (!header) return false;
  const decoded = base64UrlDecode(header);
  if (!decoded) return false;
  try {
    const parsed: unknown = JSON.parse(decoded);
    return typeof parsed === 'object' && parsed !== null && 'alg' in parsed;
  } catch {
    return false;
  }
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Generic secret: long enough and random-looking (not a plain word). */
export function highEntropy(value: string): boolean {
  return value.length >= 12 && shannonEntropy(value) >= 3.0;
}

/**
 * Looks like a password rather than an ordinary word: 6+ chars with a digit, a
 * symbol (incl. `_`), or mixed case. Letters of any script count as letters.
 */
export function passwordLike(value: string): boolean {
  if (value.length < 6) return false;
  return /\d/.test(value) || /[^\p{L}\p{N}]/u.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
}

/** International phone: 8–15 digits (E.164 bounds). */
export function phone(value: string): boolean {
  const n = digitsOf(value).length;
  return n >= 8 && n <= 15;
}

/** GPS pair: latitude in [-90, 90], longitude in [-180, 180]. */
export function gps(value: string): boolean {
  const [lat, lon] = value.split(',').map((part) => Number(part.trim()));
  return (
    lat !== undefined && lon !== undefined &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/** VIN: 17 chars mixing letters and at least 3 digits (rules out plain words). */
export function vin(value: string): boolean {
  return /[A-Z]/i.test(value) && (value.match(/\d/g)?.length ?? 0) >= 3;
}

/** IPv6 (compressed form): at least three hex groups and one hex letter or `::`. */
export function ipv6(value: string): boolean {
  const groups = value.split(':').filter((g) => g.length > 0);
  return groups.length >= 3 && groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g));
}

export const VALIDATORS = {
  luhn,
  card,
  saudiId,
  iban,
  jwt,
  highEntropy,
  passwordLike,
  phone,
  gps,
  vin,
  ipv6,
} as const;

export type ValidatorName = keyof typeof VALIDATORS;
