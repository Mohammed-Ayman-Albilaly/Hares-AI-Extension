import { describe, expect, it } from 'vitest';
import { ServerClock, CLOCK_OFFSET_KEY } from '../../src/backend/clock';
import { MAX_QUEUED, Outbox, OUTBOX_KEY } from '../../src/backend/outbox';
import { Session } from '../../src/backend/session';
import {
  BACKOFF_MAX_MS,
  MAX_EVENT_AGE_MS,
  UPLOAD_STATE_KEY,
  backoffMs,
  createUploader,
  type UploadState,
} from '../../src/backend/uploader';
import type { EventDraft } from '../../src/logging/event';
import { MemoryArea, TOKENS, apiError, scriptedFetch, type RecordedRequest, type ScriptedResponse } from '../helpers/backend';

const NOW = Date.parse('2026-10-26T09:00:00.000Z');

function draft(n: number, extra: Partial<EventDraft> = {}): EventDraft {
  return {
    log_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    occurred_at: NOW - n * 1000,
    platform: 'CHATGPT',
    risk_level: 'MEDIUM',
    action: 'WARNED',
    categories: ['CONTACT_INFO'],
    classification_source: 'LOCAL_AI',
    user_decision: 'NONE',
    rule_id: null,
    schema_version: 1,
    ...extra,
  };
}

const isLogs = (r: RecordedRequest) => r.url.endsWith('/logs');

async function setup(handler: (r: RecordedRequest, nth: number) => ScriptedResponse | Promise<ScriptedResponse>) {
  const local = new MemoryArea();
  let logCalls = 0;
  const { fetch, requests } = scriptedFetch((r) => {
    if (r.url.endsWith('/extension/login')) return { body: TOKENS(1) };
    if (r.url.endsWith('/extension/refresh')) return { body: TOKENS(2) };
    return isLogs(r) ? handler(r, ++logCalls) : { body: {} };
  });
  const clock = { now: NOW };
  const sessionObj = new Session({ api: { baseUrl: 'http://api.test/api', fetch }, local, session: new MemoryArea(), now: () => clock.now });
  await sessionObj.login('a@example.test', 'x');
  const outbox = new Outbox(local);
  const serverClock = new ServerClock(undefined, () => clock.now);
  const scheduled: number[] = [];
  const sleeps: number[] = [];
  const uploader = createUploader({
    session: sessionObj,
    outbox,
    clock: serverClock,
    state: local,
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    schedule: (ms) => {
      scheduled.push(ms);
    },
  });
  const sent = () => requests.filter(isLogs);
  const state = () => local.data.get(UPLOAD_STATE_KEY) as UploadState | undefined;
  return { uploader, outbox, local, clock, serverClock, session: sessionObj, requests, sent, scheduled, sleeps, state };
}

describe('outbox', () => {
  it('keeps order, ignores a duplicate log_id, and survives a new instance on the same storage', async () => {
    const area = new MemoryArea();
    const box = new Outbox(area);
    await box.push(draft(1));
    await box.push(draft(2));
    await box.push(draft(1));
    expect(await box.size()).toBe(2);
    expect((await new Outbox(area).peek())?.log_id).toBe(draft(1).log_id);
    await box.remove(draft(1).log_id);
    expect((await box.peek())?.log_id).toBe(draft(2).log_id);
    await box.clear();
    expect(await box.size()).toBe(0);
  });

  it('holds at most 500 events and drops the oldest', async () => {
    const box = new Outbox(new MemoryArea());
    for (let i = 1; i <= MAX_QUEUED + 3; i += 1) await box.push(draft(i));
    expect(await box.size()).toBe(MAX_QUEUED);
    expect((await box.peek())?.log_id).toBe(draft(4).log_id);
  });

  it('does not lose events pushed at the same moment (two tabs)', async () => {
    const box = new Outbox(new MemoryArea());
    await Promise.all(Array.from({ length: 20 }, (_, i) => box.push(draft(i + 1))));
    expect(await box.size()).toBe(20);
  });

  it('ignores damaged entries in storage', async () => {
    const area = new MemoryArea();
    await area.set({ [OUTBOX_KEY]: [draft(1), { log_id: 'broken' }, 'junk'] });
    expect(await new Outbox(area).size()).toBe(1);
  });
});

describe('uploader', () => {
  it('sends the queue in order, one request per event, with the allowlisted body', async () => {
    const t = await setup(() => ({ status: 201, body: {} }));
    await t.outbox.push(draft(1));
    await t.outbox.push(draft(2));
    await t.uploader.flush();
    expect(t.sent().map((r) => (r.body as { log_id: string }).log_id)).toEqual([draft(1).log_id, draft(2).log_id]);
    const body = t.sent()[0]!.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['action', 'categories', 'classification_source', 'event_time', 'log_id', 'platform', 'risk_level', 'rule_id', 'schema_version', 'user_decision'].sort(),
    );
    expect(t.sent()[0]!.headers.Authorization).toBe('Bearer access-1');
    expect(await t.outbox.size()).toBe(0);
    expect(t.sleeps).toEqual([1000]); // spaced out between events, not after the last
  });

  it('a duplicate (200) counts as sent', async () => {
    const t = await setup(() => ({ status: 200 }));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(0);
  });

  it('every retry sends the same log_id', async () => {
    const t = await setup((_r, nth) => (nth === 1 ? apiError(503, 'UNAVAILABLE') : { status: 201 }));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(1);
    t.clock.now += 3000;
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(0);
    expect(new Set(t.sent().map((r) => (r.body as { log_id: string }).log_id)).size).toBe(1);
  });

  it('5xx and offline: backs off and keeps the event; a success resets the backoff', async () => {
    let fail = true;
    const t = await setup(() => (fail ? apiError(500, 'INTERNAL') : { status: 201 }));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(t.state()).toMatchObject({ attempts: 1, nextAttemptAt: NOW + 2000 });
    expect(t.scheduled).toEqual([2000]);

    await t.uploader.flush(); // too early: nothing is sent
    expect(t.sent()).toHaveLength(1);

    t.clock.now += 2000;
    await t.uploader.flush();
    expect(t.state()).toMatchObject({ attempts: 2 });
    expect(t.scheduled).toEqual([2000, 4000]);

    fail = false;
    t.clock.now += 4000;
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(0);
    expect(t.state()).toMatchObject({ attempts: 0, nextAttemptAt: 0 });
  });

  it('the backoff doubles up to 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffMs(30)).toBe(BACKOFF_MAX_MS);
  });

  it('offline (network error) keeps the event', async () => {
    const t = await setup(() => {
      throw new Error('offline');
    });
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(1);
    expect(t.state()?.attempts).toBe(1);
  });

  it('429 waits for Retry-After and keeps the event', async () => {
    const t = await setup(() => apiError(429, 'RATE_LIMITED', { headers: { 'Retry-After': '30' } }));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(1);
    expect(t.state()?.nextAttemptAt).toBe(NOW + 30_000);
    expect(t.scheduled).toEqual([30_000]);
    await t.uploader.flush();
    expect(t.sent()).toHaveLength(1);
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['EVENT_TIME_OUT_OF_RANGE', 400],
    ['PAYLOAD_TOO_LARGE', 413],
  ])('%s drops that event and carries on with the next', async (code, status) => {
    const t = await setup((_r, nth) => (nth === 1 ? apiError(status, code) : { status: 201 }));
    await t.outbox.push(draft(1));
    await t.outbox.push(draft(2));
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(0);
    expect(t.sent()).toHaveLength(2);
  });

  it('DEPARTMENT_INACTIVE pauses uploads, keeps the queue and the session, and resumes after a policy check', async () => {
    let inactive = true;
    const t = await setup(() => (inactive ? apiError(403, 'DEPARTMENT_INACTIVE') : { status: 201 }));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(t.state()?.paused).toBe(true);
    expect(await t.outbox.size()).toBe(1);
    expect(await t.session.isSignedIn()).toBe(true);

    await t.uploader.flush(); // still paused: no request
    expect(t.sent()).toHaveLength(1);

    inactive = false;
    await t.uploader.resume();
    expect(t.state()?.paused).toBe(false);
    expect(await t.outbox.size()).toBe(0);
  });

  it('TOKEN_EXPIRED refreshes and sends the same event again', async () => {
    const t = await setup((r) => (r.headers.Authorization === 'Bearer access-1' ? apiError(401, 'TOKEN_EXPIRED') : { status: 201 }));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    expect(await t.outbox.size()).toBe(0);
    expect(t.sent().at(-1)!.headers.Authorization).toBe('Bearer access-2');
  });

  it('ACCOUNT_INACTIVE ends the session and stops without dropping the queue itself', async () => {
    const t = await setup(() => apiError(401, 'ACCOUNT_INACTIVE'));
    await t.outbox.push(draft(1));
    await t.outbox.push(draft(2));
    await t.uploader.flush();
    expect(await t.session.isSignedIn()).toBe(false);
    expect(t.sent()).toHaveLength(1);
  });

  it('sends nothing when signed out', async () => {
    const t = await setup(() => ({ status: 201 }));
    await t.outbox.push(draft(1));
    await t.session.logout();
    await t.uploader.flush();
    expect(t.sent()).toHaveLength(0);
  });

  it('drops events older than 89 days instead of sending them', async () => {
    const t = await setup(() => ({ status: 201 }));
    await t.outbox.push(draft(1, { occurred_at: NOW - MAX_EVENT_AGE_MS - 1000 }));
    await t.outbox.push(draft(2));
    await t.uploader.flush();
    expect(t.sent().map((r) => (r.body as { log_id: string }).log_id)).toEqual([draft(2).log_id]);
  });

  it('flush runs once at a time', async () => {
    const t = await setup(() => ({ status: 201 }));
    await t.outbox.push(draft(1));
    await Promise.all([t.uploader.flush(), t.uploader.flush(), t.uploader.flush()]);
    expect(t.sent()).toHaveLength(1);
  });

  it('flush with a time limit stops before the queue is empty', async () => {
    const t = await setup(() => ({ status: 201 }));
    for (let i = 1; i <= 5; i += 1) await t.outbox.push(draft(i));
    await t.uploader.flush({ maxMs: 500 });
    expect(t.sent().length).toBeLessThan(5);
    expect(t.sent().length).toBeGreaterThanOrEqual(1);
  });

  it('reset forgets the pause and the backoff', async () => {
    const t = await setup(() => apiError(403, 'DEPARTMENT_INACTIVE'));
    await t.outbox.push(draft(1));
    await t.uploader.flush();
    await t.uploader.reset();
    expect(t.state()).toBeUndefined();
  });
});

describe('server clock', () => {
  it('stamps events with the server time when the device clock is wrong', async () => {
    const t = await setup(() => ({ status: 201 }));
    const device = NOW;
    t.serverClock.observe(new Date(device + 3_600_000).toUTCString()); // device is an hour behind
    expect(t.serverClock.offsetMs).toBe(3_600_000);
    await t.outbox.push(draft(0));
    await t.uploader.flush();
    expect((t.sent()[0]!.body as { event_time: string }).event_time).toBe(new Date(NOW + 3_600_000).toISOString());
  });

  it('ignores a difference of the header resolution, and a bad header', () => {
    const area = new MemoryArea();
    const c = new ServerClock(area, () => NOW);
    c.observe(new Date(NOW + 900).toUTCString());
    expect(c.offsetMs).toBe(0);
    c.observe('not a date');
    expect(c.offsetMs).toBe(0);
  });

  it('remembers the offset across a service worker restart', async () => {
    const area = new MemoryArea();
    new ServerClock(area, () => NOW).observe(new Date(NOW - 600_000).toUTCString());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(area.data.get(CLOCK_OFFSET_KEY)).toBe(-600_000);
    const restarted = new ServerClock(area, () => NOW);
    await restarted.load();
    expect(restarted.offsetMs).toBe(-600_000);
  });
});
