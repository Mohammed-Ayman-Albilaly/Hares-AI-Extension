/**
 * Shared messaging protocol.
 *
 * This is the single source of truth for the message shapes that travel
 * between the extension contexts (content script <-> background <-> offscreen)
 * and the dedicated Web Worker. It contains zero inference logic — Phase 1
 * proved the round-trip path and Phase 2 adds the `classify` request/response
 * contract over the same channel.
 */

import type { ClassifyResult } from '../model/contract';

/** Which extension context a runtime message is addressed to. */
export const TARGET = {
  CONTENT: 'content',
  BACKGROUND: 'background',
  OFFSCREEN: 'offscreen',
  WORKER: 'worker',
} as const;

export type MessageTarget = (typeof TARGET)[keyof typeof TARGET];

/** Message type discriminators. */
export const MSG = {
  PROBE: 'hares/probe',
  PROBE_RESULT: 'hares/probe-result',
  CLASSIFY: 'hares/classify',
  CLASSIFY_RESULT: 'hares/classify-result',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

/**
 * Request sent over chrome.runtime IPC.
 * Content script -> background -> offscreen.
 */
export interface ProbeMessage {
  target: MessageTarget;
  type: typeof MSG.PROBE;
  id: string;
  /** The originating platform (chatgpt | claude | gemini). */
  platform?: string;
}

/**
 * Response returned over chrome.runtime IPC back up the chain
 * (offscreen -> background -> content script).
 */
export interface ProbeResponse {
  ok: boolean;
  /** Payload echoed from the worker, e.g. `worker-ok`. */
  result: string;
  /** Whether the dedicated Web Worker is alive and responded. */
  workerUp: boolean;
  /** Whether the offscreen document was involved in the round-trip. */
  offscreen: boolean;
  platform?: string;
  error?: string;
  at: string;
}

/**
 * Message posted directly to the dedicated Web Worker via postMessage
 * (not chrome.runtime IPC).
 */
export interface WorkerProbeMessage {
  type: typeof MSG.PROBE;
  id: string;
}

/** Message posted back from the dedicated Web Worker via postMessage. */
export interface WorkerProbeResult {
  type: typeof MSG.PROBE_RESULT;
  id: string;
  ok: boolean;
  result: string;
}

/**
 * Classification request sent over chrome.runtime IPC.
 * Content script -> background -> offscreen.
 */
export interface ClassifyRequest {
  target: MessageTarget;
  type: typeof MSG.CLASSIFY;
  id: string;
  /** The prompt text to classify. Only ever travels over local IPC. */
  prompt: string;
  /** The originating platform (chatgpt | claude | gemini). */
  platform?: string;
}

/**
 * Classification response returned over chrome.runtime IPC back up the chain
 * (offscreen -> background -> content script).
 */
export interface ClassifyResponse {
  ok: boolean;
  /** The classifier result when `ok` is true. */
  result?: ClassifyResult;
  /** Whether the dedicated Web Worker is alive and responded. */
  workerUp: boolean;
  /** Whether the offscreen document was involved in the round-trip. */
  offscreen: boolean;
  platform?: string;
  error?: string;
  at: string;
}

/**
 * Classification request posted directly to the dedicated Web Worker via
 * postMessage (not chrome.runtime IPC).
 */
export interface WorkerClassifyRequest {
  type: typeof MSG.CLASSIFY;
  id: string;
  prompt: string;
}

/** Classification result posted back from the dedicated Web Worker. */
export interface WorkerClassifyResult {
  type: typeof MSG.CLASSIFY_RESULT;
  id: string;
  ok: boolean;
  result?: ClassifyResult;
  error?: string;
}

/** Narrowing guard for incoming probe requests. */
export function isProbeMessage(value: unknown): value is ProbeMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate['type'] === MSG.PROBE &&
    typeof candidate['id'] === 'string'
  );
}

/** Narrowing guard for incoming classify requests. */
export function isClassifyRequest(value: unknown): value is ClassifyRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate['type'] === MSG.CLASSIFY &&
    typeof candidate['id'] === 'string' &&
    typeof candidate['prompt'] === 'string'
  );
}
