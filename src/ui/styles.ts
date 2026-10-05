/**
 * Hares AI — overlay styles, scoped inside a shadow root so the host page's CSS
 * cannot leak in (and ours cannot leak out).
 */

export const OVERLAY_CSS = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }

.root {
  --bg: #ffffff;
  --fg: #16181d;
  --muted: #5b6270;
  --line: #e3e6eb;
  --chip: #f3f4f6;
  --accent: #1f6feb;
  --accent-fg: #ffffff;
  --focus: #1f6feb;
  --high: #c62828;
  --high-bg: #fdecec;
  --medium: #b45309;
  --medium-bg: #fff4e5;
  --low: #4d6b1f;
  --low-bg: #eef5e4;
  --ph-bg: #e8f0fe;
  --ph-fg: #1a4fb5;
  --shadow: 0 18px 50px rgba(15, 18, 25, 0.22), 0 2px 8px rgba(15, 18, 25, 0.08);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .root {
    --bg: #1c1f26;
    --fg: #eceef2;
    --muted: #a3aab8;
    --line: #313642;
    --chip: #262a33;
    --accent: #4c8dff;
    --accent-fg: #0b1220;
    --focus: #7aa8ff;
    --high: #ff7b72;
    --high-bg: #3a1d1d;
    --medium: #f0a64a;
    --medium-bg: #36291a;
    --low: #a9c97a;
    --low-bg: #26301b;
    --ph-bg: #1f2d4a;
    --ph-fg: #9cc0ff;
    --shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  }
}

/* ---- dialog ------------------------------------------------------------ */
.backdrop {
  position: fixed; inset: 0;
  background: rgba(10, 12, 16, 0.38);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  z-index: 2147483647;
  animation: fade-in 120ms ease-out;
}
.dialog {
  width: min(560px, 100%);
  max-height: min(80vh, 680px);
  display: flex; flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden;
  animation: rise 140ms ease-out;
}
.head { display: flex; gap: 10px; align-items: center; padding: 16px 18px 8px; }
.badge {
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  padding: 3px 8px; border-radius: 999px;
}
.badge.HIGH { color: var(--high); background: var(--high-bg); }
.badge.MEDIUM { color: var(--medium); background: var(--medium-bg); }
.badge.LOW { color: var(--low); background: var(--low-bg); }
.title { font-size: 16px; font-weight: 650; margin: 0; }
.sub { color: var(--muted); margin: 0 18px 10px; }
.body { overflow: auto; padding: 0 18px; }
.section-label {
  font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted); margin: 12px 0 6px;
}
.findings { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.finding {
  display: inline-flex; gap: 6px; align-items: center;
  background: var(--chip); border-radius: 8px; padding: 4px 8px; font-size: 13px;
}
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.HIGH { background: var(--high); }
.dot.MEDIUM { background: var(--medium); }
.dot.LOW { background: var(--low); }
.ph-name { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--muted); }
.preview {
  white-space: pre-wrap; word-break: break-word;
  background: var(--chip); border-radius: 10px; padding: 10px 12px;
  max-height: 220px; overflow: auto; margin-bottom: 4px;
}
.ph {
  font-family: ui-monospace, Consolas, monospace; font-size: 12.5px;
  background: var(--ph-bg); color: var(--ph-fg);
  border-radius: 5px; padding: 0 4px;
}
.actions {
  display: flex; gap: 8px; justify-content: flex-end; align-items: center;
  padding: 14px 18px 16px; border-top: 1px solid var(--line); margin-top: 14px;
}
.hint { margin-right: auto; color: var(--muted); font-size: 12px; }
button {
  font: inherit; font-weight: 600; cursor: pointer;
  border-radius: 9px; padding: 8px 14px;
  border: 1px solid var(--line); background: var(--bg); color: var(--fg);
}
button.ghost { border-color: transparent; color: var(--muted); }
/* The selected button is the filled one: it is what Enter will press. */
button.selected { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
kbd {
  font: 11px ui-monospace, Consolas, monospace;
  border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px;
}

/* ---- toast ------------------------------------------------------------- */
.toast {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  max-width: min(360px, calc(100vw - 32px));
  display: flex; gap: 8px; align-items: center;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 6px 20px rgba(15, 18, 25, 0.14);
  padding: 8px 12px; font-size: 13px;
  pointer-events: none;
  opacity: 0; transform: translateY(6px);
  transition: opacity 220ms ease, transform 220ms ease;
}
.toast.show { opacity: 0.96; transform: translateY(0); }

@keyframes fade-in { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
@media (prefers-reduced-motion: reduce) {
  .backdrop, .dialog { animation: none; }
  .toast { transition: none; }
}
`;

/** Create a fixed-position shadow host attached to <html>. */
export function createShadowHost(id: string): { host: HTMLElement; root: HTMLDivElement } {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  const root = document.createElement('div');
  root.className = 'root';
  shadow.append(style, root);
  document.documentElement.appendChild(host);
  return { host, root };
}
