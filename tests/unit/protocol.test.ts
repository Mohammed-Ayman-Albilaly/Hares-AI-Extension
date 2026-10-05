import { describe, expect, it } from 'vitest';

import {
  isClassifyRequest,
  isProbeMessage,
  MSG,
  TARGET,
} from '../../src/messaging/protocol';

describe('messaging protocol', () => {
  it('recognizes a valid probe request', () => {
    expect(
      isProbeMessage({
        target: TARGET.BACKGROUND,
        type: MSG.PROBE,
        id: 'abc',
        platform: 'chatgpt',
      }),
    ).toBe(true);
  });

  it('rejects messages that are not probe requests', () => {
    expect(isProbeMessage({ target: TARGET.BACKGROUND, type: 'nope' })).toBe(
      false,
    );
    expect(isProbeMessage(null)).toBe(false);
    expect(isProbeMessage('not-an-object')).toBe(false);
  });

  it('recognizes a valid classify request', () => {
    expect(
      isClassifyRequest({
        target: TARGET.BACKGROUND,
        type: MSG.CLASSIFY,
        id: 'abc',
        prompt: 'my prompt',
        platform: 'chatgpt',
      }),
    ).toBe(true);
  });

  it('rejects classify requests that are missing a prompt', () => {
    expect(
      isClassifyRequest({
        target: TARGET.BACKGROUND,
        type: MSG.CLASSIFY,
        id: 'abc',
      }),
    ).toBe(false);
    expect(isClassifyRequest(null)).toBe(false);
    expect(isClassifyRequest('not-an-object')).toBe(false);
  });
});
