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

export interface PolicySyncDeps {
  session: Session;
  /** ETag of the stored policy, or null when none is stored (then no If-None-Match is sent). */
  getEtag(): Promise<string | null>;
  save(policy: Policy, etag: string | null): Promise<boolean>;
  /** The check succeeded (200 or 304). */
  onChecked?(): void | Promise<void>;
}

export function createPolicySync(deps: PolicySyncDeps): () => Promise<SyncResult> {
  let running: Promise<SyncResult> | null = null;

  async function run(): Promise<SyncResult> {
    if (!(await deps.session.isSignedIn())) return 'SIGNED_OUT';
    try {
      const etag = await deps.getEtag();
      const response = await deps.session.request<unknown>('/policy/bundle', {
        headers: etag ? { 'If-None-Match': etag } : {},
      });
      if (response.status === 304) {
        await deps.onChecked?.();
        return 'UNCHANGED';
      }
      const bundle = parseBundle(response.body);
      if (!bundle) {
        console.warn('[hares] policy bundle rejected: unexpected shape');
        return 'INVALID';
      }
      const saved = await deps.save(bundleToPolicy(bundle), response.headers.get('ETag'));
      if (!saved) return 'INVALID';
      await deps.onChecked?.();
      return 'UPDATED';
    } catch (error) {
      if (!(error instanceof ApiError)) console.warn('[hares] policy check failed:', error);
      return (await deps.session.isSignedIn()) ? 'FAILED' : 'SIGNED_OUT';
    }
  }

  return () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };
}
