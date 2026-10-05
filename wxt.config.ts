import { defineConfig } from 'wxt';
import type { Plugin } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Copy the ONNX Runtime WASM assets that Transformers.js ships into the build
 * output so the runtime never depends on a CDN fetch for runtime code. They are
 * served from the extension origin (see wasmPaths in worker/inference.worker.ts).
 */
function localOrtWasmAssets(): Plugin {
  let outDir = '';
  const files = [
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
  ];

  return {
    name: 'hares-local-ort-wasm-assets',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const src = resolve(rootDir, 'node_modules/@huggingface/transformers/dist');
      const dest = resolve(outDir, 'wasm');
      mkdirSync(dest, { recursive: true });
      for (const file of files) {
        copyFileSync(resolve(src, file), resolve(dest, file));
      }
    },
  };
}

export default defineConfig({
  manifest: {
    name: 'Hares AI',
    description:
      'Reduces the risk of accidentally disclosing sensitive information when sending prompts to AI platforms.',
    permissions: ['offscreen', 'storage'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
      // Phase 2 bootstrap only: fetch the pinned model artifact from Hugging
      // Face on first run. Only model/runtime files are fetched — never prompt
      // content. These are removed once Phase 12 disables remote model loading
      // and the model is cached locally. Least-privilege is otherwise unchanged.
      'https://huggingface.co/*',
      'https://*.huggingface.co/*',
      'https://*.hf.co/*',
      'https://*.cdn.hf.co/*',
    ],
    // Preserve the MV3 extension_pages policy. `wasm-unsafe-eval` is required
    // by the local ONNX/WASM runtime (onnxruntime-web).
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  vite: () => ({
    plugins: [localOrtWasmAssets()],
  }),
});
