/**
 * Hares AI — keep the policy up to date with `GET /policy/bundle`.
 *
 * Runs on browser start, after sign-in, and every few minutes. Every request
 * carries `If-None-Match` with the stored ETag, so an unchanged policy costs a
 * 304 with no body. If a check fails (offline, server error, bad answer), the
 * last good policy stays in force; with none ever received, the built-in
 * default applies.
 */

import { ApiError } from './api';
import { bundleToPolicy, parseBundle } from '../policy/bundle';
import type { Policy } from '../policy/types';
import type { Session } from './session';

export type SyncResult = 'UPDATED' | 'UNCHANGED' | 'SIGNED_OUT' | 'INVALID' | 'FAILED';

/** What one check did, for the log: the HTTP status (0 = no answer, null = no request was made). */
export interface SyncAttempt {
  result: SyncResult;
  status: number | null;
  etag: string | null;
  /** Epoch ms. */
  at: number;
}

export interface PolicySyncDeps {
  session: Session;
  /** ETag of the stored policy, or null when none is stored (then no If-None-Match is sent). */
  getEtag(): Promise<string | null>;
  save(policy: Policy, etag: string | null): Promise<boolean>;
  /** The check succeeded (200 or 304). */
  onChecked?(): void | Promise<void>;
  /** Every check that ran, whatever its outcome. */
  onAttempt?(attempt: SyncAttempt): void | Promise<void>;
  now?: () => number;
}

export function createPolicySync(deps: PolicySyncDeps): () => Promise<SyncResult> {
  let running: Promise<SyncResult> | null = null;
  const now = deps.now ?? Date.now;

  async function run(): Promise<SyncResult> {
    let status: number | null = null;
    let etag: string | null = null;
    const finish = async (result: SyncResult): Promise<SyncResult> => {
      try {
        await deps.onAttempt?.({ result, status, etag, at: now() });
      } catch (error) {
        console.warn('[hares] could not record the policy check:', error);
      }
      return result;
    };

    if (!(await deps.session.isSignedIn())) return finish('SIGNED_OUT');
    try {
      etag = await deps.getEtag();
      const response = await deps.session.request<unknown>('/policy/bundle', {
        headers: etag ? { 'If-None-Match': etag } : {},
      });
      status = response.status;
      if (response.status === 304) {
        await deps.onChecked?.();
        return await finish('UNCHANGED');
      }
      const bundle = parseBundle(response.body);
      if (!bundle) {
        console.warn('[hares] policy bundle rejected: unexpected shape');
        return await finish('INVALID');
      }
      etag = response.headers.get('ETag');
      const saved = await deps.save(bundleToPolicy(bundle), etag);
      if (!saved) return await finish('INVALID');
      await deps.onChecked?.();
      return await finish('UPDATED');
    } catch (error) {
      if (error instanceof ApiError) status = error.status;
      else console.warn('[hares] policy check failed:', error);
      return finish((await deps.session.isSignedIn()) ? 'FAILED' : 'SIGNED_OUT');
    }
  }

  return () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };
}
