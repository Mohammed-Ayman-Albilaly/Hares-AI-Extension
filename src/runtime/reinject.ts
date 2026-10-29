/**
 * Hares AI — put the content scripts back into pages that were already open.
 *
 * When the extension is installed, updated or reloaded, Chrome does not run its
 * content scripts in tabs that were open before; the old copy there is cut off
 * from the extension and the page needs a manual refresh. The background injects
 * the new copy into those tabs itself, so protection and policy updates carry on
 * without the user doing anything.
 */

export interface ManifestContentScript {
  matches?: string[];
  js?: string[];
}

export interface ReinjectDeps {
  contentScripts: ManifestContentScript[];
  queryTabs(matches: string[]): Promise<Array<{ id?: number }>>;
  inject(tabId: number, files: string[]): Promise<void>;
}

/** Inject every content script into the open tabs it matches. Returns how many tabs were reached. */
export async function reinjectContentScripts(deps: ReinjectDeps): Promise<number> {
  let reached = 0;
  for (const script of deps.contentScripts) {
    const files = script.js ?? [];
    const matches = script.matches ?? [];
    if (files.length === 0 || matches.length === 0) continue;
    let tabs: Array<{ id?: number }>;
    try {
      tabs = await deps.queryTabs(matches);
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        await deps.inject(tab.id, files);
        reached += 1;
      } catch {
        // A tab that cannot be scripted (closed, discarded, an error page) is skipped.
      }
    }
  }
  return reached;
}
