/**
 * Hares AI — background service worker.
 *
 * Thin orchestrator only. It holds no inference logic. It proves the round-trip:
 * receive a probe or classify request from a content script, ensure the
 * offscreen document exists, forward the request to it, and relay the worker
 * response back to the content script.
 *
 * The service worker is suspended on idle and does not reliably expose WebGPU,
 * so all heavy work must live in the offscreen document / dedicated worker
 * (implemented in a later phase).
 */

import {
  MSG,
  TARGET,
  type ClassifyRequest,
  type ClassifyResponse,
  type ProbeMessage,
  type ProbeResponse,
} from '../src/messaging/protocol';

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

export default defineBackground(() => {
  console.info('[hares] background service worker started');

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const probe = message as ProbeMessage | undefined;
    if (probe?.target === TARGET.BACKGROUND && probe?.type === MSG.PROBE) {
      void handleProbe(probe)
        .then(sendResponse)
        .catch((error: unknown) => {
          const response: ProbeResponse = {
            ok: false,
            result: 'error',
            workerUp: false,
            offscreen: false,
            platform: probe.platform,
            error: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          };
          sendResponse(response);
        });

      // Keep the message channel open while we respond asynchronously.
      return true;
    }

    const classify = message as ClassifyRequest | undefined;
    if (
      classify?.target === TARGET.BACKGROUND &&
      classify?.type === MSG.CLASSIFY
    ) {
      console.info("[hares] CLASSIFY received");
      void handleClassify(classify)
        .then(sendResponse)
        .catch((error: unknown) => {
          const response: ClassifyResponse = {
            ok: false,
            workerUp: false,
            offscreen: false,
            platform: classify.platform,
            error: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          };
          sendResponse(response);
        });

      // Keep the message channel open while we respond asynchronously.
      return true;
    }

    return;
  });
});

async function handleProbe(probe: ProbeMessage): Promise<ProbeResponse> {
  await ensureOffscreenDocument();

  const response = await browser.runtime.sendMessage({
    target: TARGET.OFFSCREEN,
    type: MSG.PROBE,
    id: probe.id,
    platform: probe.platform,
  });

  const offscreenResponse = response as ProbeResponse | undefined;

  return {
    ok: offscreenResponse?.ok === true,
    result: String(offscreenResponse?.result ?? 'no-offscreen-response'),
    workerUp: offscreenResponse?.workerUp === true,
    offscreen: true,
    platform: probe.platform,
    at: new Date().toISOString(),
  };
}

async function handleClassify(
  request: ClassifyRequest,
): Promise<ClassifyResponse> {
  await ensureOffscreenDocument();

  const response = await browser.runtime.sendMessage({
    target: TARGET.OFFSCREEN,
    type: MSG.CLASSIFY,
    id: request.id,
    prompt: request.prompt,
    platform: request.platform,
  });

  const offscreenResponse = response as ClassifyResponse | undefined;

  return {
    ok: offscreenResponse?.ok === true,
    result: offscreenResponse?.result,
    workerUp: offscreenResponse?.workerUp === true,
    offscreen: true,
    platform: request.platform,
    error: offscreenResponse?.error,
    at: new Date().toISOString(),
  };
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  await browser.offscreen.createDocument({
    url: browser.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
    reasons: [browser.offscreen.Reason.WORKERS],
    justification: 'Host the local inference Web Worker',
  });
}

async function hasOffscreenDocument(): Promise<boolean> {
  try {
    const contexts = await browser.runtime.getContexts({
      contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [browser.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
    });
    return contexts.length > 0;
  } catch {
    // Older CHROME/Edge versions: fall back to matching clients by URL.
    const workerSelf = self as unknown as {
      clients: { matchAll: () => Promise<Array<{ url: string }>> };
    };
    const matchedClients = await workerSelf.clients.matchAll();
    return matchedClients.some((client) =>
      client.url.includes(browser.runtime.id),
    );
  }
}
