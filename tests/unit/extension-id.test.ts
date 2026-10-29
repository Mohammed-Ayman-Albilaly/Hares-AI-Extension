import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY } from '../../extension-key';

/** Chrome's rule: the first 128 bits of SHA-256(public key DER), written with the letters a-p. */
function extensionIdOf(publicKeyBase64: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode('a'.charCodeAt(0) + parseInt(h, 16))).join('');
}

describe('extension id', () => {
  it('is the one Chrome derives from the manifest key', () => {
    expect(extensionIdOf(EXTENSION_PUBLIC_KEY)).toBe(EXTENSION_ID);
    expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/);
  });
});
