import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ id: 'abc' as string | undefined, sendMessage: (async (): Promise<unknown> => undefined) as (...args: unknown[]) => Promise<unknown> }));
vi.mock('wxt/browser', () => ({ browser: { runtime } }));

import { isContextInvalidatedError, isExtensionContextValid } from '../../src/runtime/context';
import type { EventDraft } from '../../src/logging/event';
import { reportEvent } from '../../src/logging/report';

const EVENT: EventDraft = {
  log_id: '3f6c2a1e-8b4d-4c7a-9e2f-1a5b7c9d0e21',
  occurred_at: 0,
  platform: 'CHATGPT',
  risk_level: 'NONE',
  action: 'ALLOWED',
  categories: [],
  classification_source: 'LOCAL_AI',
  user_decision: 'NONE',
  rule_id: null,
  schema_version: 1,
};

beforeEach(() => {
  runtime.id = 'abc';
  vi.restoreAllMocks();
  runtime.sendMessage = vi.fn(async () => ({ ok: true }));
});

describe('extension context', () => {
  it('is valid while the extension id exists, invalid once it is gone', () => {
    expect(isExtensionContextValid()).toBe(true);
    runtime.id = undefined;
    expect(isExtensionContextValid()).toBe(false);
  });

  it('recognises the invalidated-context error', () => {
    expect(isContextInvalidatedError(new Error('Extension context invalidated.'))).toBe(true);
    expect(isContextInvalidatedError('Extension context invalidated')).toBe(true);
    expect(isContextInvalidatedError(new Error('network down'))).toBe(false);
    expect(isContextInvalidatedError(undefined)).toBe(false);
  });
});

describe('reportEvent after the extension was reloaded', () => {
  it('sends the event while the context is valid', async () => {
    await reportEvent(EVENT);
    expect(vi.mocked(runtime.sendMessage)).toHaveBeenCalledTimes(1);
  });

  it('does nothing, and logs nothing, once the context is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runtime.id = undefined;
    await reportEvent(EVENT);
    expect(vi.mocked(runtime.sendMessage)).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('swallows the invalidated error if it happens during the call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runtime.sendMessage = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    await expect(reportEvent(EVENT)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns about other failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runtime.sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection');
    });
    await reportEvent(EVENT);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
