/**
 * Hares AI — per-conversation state: the placeholder vault and the tail of the
 * last message actually sent.
 *
 * The tail lets the analyser catch values split across messages
 * ("my password is" … next message: "Hunter2!").
 *
 * Conversations are keyed by URL path. A new chat starts on a generic path
 * ("/", "/new", "/app") and the site moves it to its own path ("/c/<id>") right
 * after the first send; that move is followed, so the conversation keeps its
 * vault and history instead of starting over.
 */

import { PlaceholderVault } from '../masking/vault';

/** How much of the previous message is joined to the next one. */
export const HISTORY_TAIL_CHARS = 160;
/** A path change this soon after a send is the site renaming the new chat. */
const RENAME_WINDOW_MS = 60_000;

export class ConversationState {
  readonly vault = new PlaceholderVault();
  lastSent: string | null = null;

  historyTail(): string {
    return this.lastSent ? this.lastSent.slice(-HISTORY_TAIL_CHARS) : '';
  }
}

export class ConversationTracker {
  private states = new Map<string, ConversationState>();
  private currentKey: string | null = null;
  private lastSendAt = 0;

  constructor(
    private readonly keyOf: () => string = () => location.pathname,
    private readonly now: () => number = () => Date.now(),
  ) {}

  current(): ConversationState {
    const key = this.keyOf();
    if (this.currentKey !== null && key !== this.currentKey && !this.states.has(key)) {
      const previous = this.states.get(this.currentKey);
      if (previous && this.now() - this.lastSendAt <= RENAME_WINDOW_MS) {
        // The site gave the new chat its own URL: carry the state over.
        this.states.delete(this.currentKey);
        this.states.set(key, previous);
      }
    }
    this.currentKey = key;
    let state = this.states.get(key);
    if (!state) {
      state = new ConversationState();
      this.states.set(key, state);
    }
    return state;
  }

  /** Record the text that actually went to the AI (original or revised). */
  recordSend(text: string): void {
    this.current().lastSent = text;
    this.lastSendAt = this.now();
  }
}
