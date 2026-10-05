/**
 * Hares AI — offscreen document.
 *
 * Created by the background service worker with reason `WORKERS`. It owns the
 * dedicated Web Worker that hosts local inference, keeping the model out of the
 * service worker and off the host page.
 *
 * Phase 1 scope: initialize, lazily spawn the module worker, forward a probe,
 * and relay the worker's deterministic response back to the background.
 *
 * Phase 2 scope: forward a `classify` request to the same worker and relay the
 * worker's typed inference result back to the background. It contains no
 * risk-tier decision logic — it only bridges the message to the worker.
 */

import {
  MSG,
  TARGET,
  type ClassifyRequest,
  type ClassifyResponse,
  type ProbeMessage,
  type ProbeResponse,
  type WorkerClassifyResult,
  type WorkerProbeResult,
} from '../../src/messaging/protocol';

let worker: Worker | null = null;

console.info('[hares] offscreen document started');

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const probe = message as ProbeMessage | undefined;
  if (probe?.target === TARGET.OFFSCREEN && probe?.type === MSG.PROBE) {
    void probeWorker(probe)
      .then(sendResponse)
      .catch((error: unknown) => {
        const response: ProbeResponse = {
          ok: false,
          result: 'error',
          workerUp: false,
          offscreen: true,
          platform: probe.platform,
          error: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        };
        sendResponse(response);
      });
    return true;
  }

  const classify = message as ClassifyRequest | undefined;
  if (classify?.target === TARGET.OFFSCREEN && classify?.type === MSG.CLASSIFY) {
    console.info('[hares] offscreen received CLASSIFY', classify.id);
    void classifyViaWorker(classify)
      .then(sendResponse)
      .catch((error: unknown) => {
        const response: ClassifyResponse = {
          ok: false,
          workerUp: false,
          offscreen: true,
          platform: classify.platform,
          error: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        };
        sendResponse(response);
      });
    return true;
  }

  return;
});

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../../worker/inference.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.addEventListener('error', (event) => {
      console.error('[hares] worker error:', event.message);
    });
  }
  return worker;
}

const PROBE_TIMEOUT_MS = 5_000;
const CLASSIFY_TIMEOUT_MS = 120_000;

function probeWorker(probe: ProbeMessage): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const { id } = probe;

    let settled = false;

    const onError = (event: ErrorEvent) => {
      finish(() => reject(new Error(event.message || 'Worker error')));
    };

    const onMessageError = () => {
      finish(() => reject(new Error('Worker message error')));
    };

    const onMessage = (event: MessageEvent<WorkerProbeResult>) => {
      const data = event.data;
      if (data?.type === MSG.PROBE_RESULT && data.id === id) {
        finish(() => {
          resolve({
            ok: data.ok,
            result: data.result,
            workerUp: true,
            offscreen: true,
            platform: probe.platform,
            at: new Date().toISOString(),
          });
        });
      }
    };

    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.removeEventListener('messageerror', onMessageError);
      clearTimeout(timeout);
    };

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('Worker probe timed out')));
    }, PROBE_TIMEOUT_MS);

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.addEventListener('messageerror', onMessageError);
    w.postMessage({ type: MSG.PROBE, id });
  });
}

function classifyViaWorker(request: ClassifyRequest): Promise<ClassifyResponse> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const { id } = request;

    let settled = false;

    const onError = (event: ErrorEvent) => {
      finish(() => reject(new Error(event.message || 'Worker error')));
    };

    const onMessageError = () => {
      finish(() => reject(new Error('Worker message error')));
    };

    const onMessage = (event: MessageEvent<WorkerClassifyResult>) => {
      const data = event.data;
      if (data?.type === MSG.CLASSIFY_RESULT && data.id === id) {
        finish(() => {
          resolve({
            ok: data.ok,
            result: data.result,
            workerUp: true,
            offscreen: true,
            platform: request.platform,
            error: data.error,
            at: new Date().toISOString(),
          });
        });
      }
    };

    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      w.removeEventListener('messageerror', onMessageError);
      clearTimeout(timeout);
    };

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    // First inference includes the model download, so allow a generous warm-up.
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('Worker classify timed out')));
    }, CLASSIFY_TIMEOUT_MS);

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.addEventListener('messageerror', onMessageError);
    w.postMessage({
      type: MSG.CLASSIFY,
      id,
      prompt: request.prompt,
    });
  });
}
