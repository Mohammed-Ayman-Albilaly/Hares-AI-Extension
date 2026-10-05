/**
 * Hares AI — MEDIUM / HIGH decision dialog.
 *
 * MEDIUM: Confirm (send original) ⟷ Send revised ⟷ Edit.
 * HIGH:   Send revised ⟷ Edit — the original can never be sent.
 *
 * Keyboard: ←/→ (and Tab) move between buttons, Enter activates the selected
 * one, Escape goes back to editing. An Enter that arrives within
 * ENTER_GUARD_MS of opening, or as an auto-repeat, is ignored: it is almost
 * always the same key press that triggered the send, not a decision.
 */

import type { AnalysisResult } from '../pipeline/analyze';
import { createShadowHost } from './styles';

export type DialogChoice = 'original' | 'revised' | 'cancel';

/** Default button on MEDIUM. 'revised' is the safe default; 'original' = Confirm. */
export const DEFAULT_MEDIUM_CHOICE: Exclude<DialogChoice, 'cancel'> = 'revised';

const ENTER_GUARD_MS = 300;
const PLACEHOLDER_SPLIT = /(\[[A-Z][A-Z0-9_]*_\d+\])/;

let open = false;

export function isDialogOpen(): boolean {
  return open;
}

interface ButtonSpec {
  choice: DialogChoice;
  label: string;
  className: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Revised text with placeholders highlighted, built from text nodes (no innerHTML). */
function renderPreview(text: string): HTMLElement {
  const pre = el('div', 'preview');
  pre.dir = 'auto';
  for (const part of text.split(PLACEHOLDER_SPLIT)) {
    if (!part) continue;
    pre.append(PLACEHOLDER_SPLIT.test(part) ? el('span', 'ph', part) : document.createTextNode(part));
  }
  return pre;
}

export function showDecisionDialog(analysis: AnalysisResult): Promise<DialogChoice> {
  const { tier } = analysis.decision;
  const isHigh = tier === 'HIGH';
  const canRevise = analysis.decision.actions.includes('send_masked');

  const buttons: ButtonSpec[] = [];
  if (!isHigh) buttons.push({ choice: 'original', label: 'Confirm', className: '' });
  if (canRevise) buttons.push({ choice: 'revised', label: 'Send revised', className: '' });
  buttons.push({ choice: 'cancel', label: 'Edit', className: 'ghost' });

  const defaultChoice: DialogChoice = isHigh
    ? canRevise ? 'revised' : 'cancel'
    : canRevise ? DEFAULT_MEDIUM_CHOICE : 'original';

  return new Promise((resolve) => {
    const { host, root } = createShadowHost('hares-dialog');
    const openedAt = performance.now();
    const previousFocus = document.activeElement as HTMLElement | null;
    open = true;

    const backdrop = el('div', 'backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'hares-title');

    const head = el('div', 'head');
    head.append(el('span', `badge ${tier}`, tier));
    const title = el(
      'h2',
      'title',
      isHigh ? 'Sensitive data blocked' : 'This message contains sensitive data',
    );
    title.id = 'hares-title';
    head.append(title);

    const sub = el(
      'p',
      'sub',
      isHigh
        ? 'The original message cannot be sent. Send the revised version, with sensitive values replaced by placeholders, or edit your message.'
        : 'Send it as written, or send the revised version with sensitive values replaced by placeholders.',
    );

    const body = el('div', 'body');
    body.append(el('div', 'section-label', 'Detected'));
    const list = el('ul', 'findings');
    for (const finding of analysis.findings) {
      const item = el('li', 'finding');
      item.append(el('span', `dot ${finding.tier}`), el('span', '', finding.categoryName));
      if (finding.placeholder) item.append(el('span', 'ph-name', finding.placeholder));
      if (finding.crossesMessages) {
        const note = el('span', 'ph-name', '↩ continues previous message');
        note.title = 'Part of this value was in your previous message, which was already sent.';
        item.append(note);
      }
      list.append(item);
    }
    body.append(list);
    if (canRevise) {
      body.append(el('div', 'section-label', 'Revised message'));
      body.append(renderPreview(analysis.revised));
    }

    const actions = el('div', 'actions');
    const hint = el('span', 'hint');
    hint.append(el('kbd', '', '←'), ' ', el('kbd', '', '→'), ' choose · ', el('kbd', '', 'Enter'), ' send · ', el('kbd', '', 'Esc'), ' edit');
    actions.append(hint);

    const buttonEls = buttons.map((spec) => {
      const b = el('button', spec.className, spec.label);
      b.type = 'button';
      b.addEventListener('click', () => finish(spec.choice));
      actions.append(b);
      return b;
    });

    dialog.append(head, sub, body, actions);
    backdrop.append(dialog);
    root.append(backdrop);

    let selected = Math.max(0, buttons.findIndex((b) => b.choice === defaultChoice));
    const select = (index: number): void => {
      selected = (index + buttonEls.length) % buttonEls.length;
      buttonEls.forEach((b, i) => b.classList.toggle('selected', i === selected));
      buttonEls[selected]?.focus({ preventScroll: true });
    };
    select(selected);

    function onKey(event: KeyboardEvent): void {
      // While open, every key belongs to the dialog — never to the page.
      event.stopImmediatePropagation();
      const { key } = event;
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab') {
        event.preventDefault();
        const step = key === 'ArrowLeft' || (key === 'Tab' && event.shiftKey) ? -1 : 1;
        select(selected + step);
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (event.repeat || performance.now() - openedAt < ENTER_GUARD_MS) return;
        const spec = buttons[selected];
        if (spec) finish(spec.choice);
      } else if (key === 'Escape') {
        event.preventDefault();
        finish('cancel');
      } else {
        event.preventDefault();
      }
    }

    function swallow(event: Event): void {
      event.stopImmediatePropagation();
    }

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', swallow, true);
    window.addEventListener('keypress', swallow, true);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish('cancel');
    });

    function finish(choice: DialogChoice): void {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', swallow, true);
      window.removeEventListener('keypress', swallow, true);
      host.remove();
      open = false;
      previousFocus?.focus?.({ preventScroll: true });
      resolve(choice);
    }
  });
}
