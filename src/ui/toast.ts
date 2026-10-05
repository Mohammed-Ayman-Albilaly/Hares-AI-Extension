/**
 * Hares AI — quiet, non-blocking toast (LOW tier notice, "copied" notices).
 * Never takes focus and ignores the pointer, so typing is never interrupted.
 */

import { createShadowHost } from './styles';

export type ToastKind = 'LOW' | 'MEDIUM' | 'HIGH' | 'info';

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3000): void {
  const { host, root } = createShadowHost('hares-toast');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  if (kind !== 'info') {
    const dot = document.createElement('span');
    dot.className = `dot ${kind}`;
    toast.append(dot);
  }
  const text = document.createElement('span');
  text.textContent = message;
  text.dir = 'auto';
  toast.append(text);
  root.append(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => host.remove(), 260);
  }, durationMs);
}
