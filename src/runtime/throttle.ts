/**
 * Hares AI — "at most once per interval".
 *
 * `ready()` answers true the first time and then again only after `intervalMs`
 * has passed since the last true answer. Used for cheap background work that
 * should follow the user's activity without running on every keystroke.
 */
export function createThrottle(intervalMs: number, now: () => number = Date.now): { ready(): boolean; touch(): void } {
  let last = Number.NEGATIVE_INFINITY;
  return {
    ready() {
      if (now() - last < intervalMs) return false;
      last = now();
      return true;
    },
    /** Count the work as just done, without asking. */
    touch() {
      last = now();
    },
  };
}
