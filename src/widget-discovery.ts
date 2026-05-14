import { App, WorkspaceLeaf } from 'obsidian';

export interface DiscoveredView {
  viewType: string;
  label: string;          // human-readable name
  isOpen: boolean;        // true if a leaf currently exists
  leafCount: number;      // how many leaves of this type are currently open
  location: 'root' | 'left' | 'right' | 'unknown';
  sampleLeaf: WorkspaceLeaf | null;
}

export class WidgetDiscovery {
  private app: App;

  constructor(app: App) {
    this.app = app;
    console.debug('[Dashboard][Discovery] WidgetDiscovery constructed');
  }

  /**
   * Scan the entire live workspace and return every unique view type found.
   * This is the ONLY source of view type information — nothing is hardcoded.
   */
  discoverAllViews(): DiscoveredView[] {
    console.debug('[Dashboard][Discovery] Starting full workspace scan');

    const map = new Map<string, DiscoveredView>();
    const { workspace } = this.app;

    // More reliable: iterate all leaves and determine their location
    workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const state = leaf.getViewState();
      const viewType = state.type;

      if (!viewType || viewType === '') {
        console.debug('[Dashboard][Discovery] Skipping leaf with empty viewType');
        return;
      }

      // Determine location by checking which split this leaf belongs to
      const location = this.getLeafLocation(leaf);

      // Get display name from the view if it has one
      const displayText = (leaf.view && typeof (leaf.view as any).getDisplayText === 'function')
        ? (leaf.view as any).getDisplayText()
        : viewType;

      console.debug(`[Dashboard][Discovery] Found leaf: viewType="${viewType}" label="${displayText}" location="${location}"`);

      if (map.has(viewType)) {
        // Already seen this type — increment count
        const existing = map.get(viewType)!;
        existing.leafCount++;
        console.debug(`[Dashboard][Discovery] Duplicate viewType "${viewType}" — leafCount now ${existing.leafCount}`);
      } else {
        map.set(viewType, {
          viewType,
          label: this.makeLabel(viewType, displayText),
          isOpen: true,
          leafCount: 1,
          location,
          sampleLeaf: leaf,
        });
      }
    });

    // Also check the internal plugin registry for view types that are registered
    // but currently have no open leaves (e.g. a plugin is installed but never opened)
    const registeredTypes = this.getRegisteredViewTypes();
    console.debug('[Dashboard][Discovery] Registered view types from plugin registry:', registeredTypes);

    for (const viewType of registeredTypes) {
      if (!map.has(viewType)) {
        console.debug(`[Dashboard][Discovery] Found registered-but-unopened viewType: "${viewType}"`);
        map.set(viewType, {
          viewType,
          label: this.makeLabel(viewType, viewType),
          isOpen: false,
          leafCount: 0,
          location: 'unknown',
          sampleLeaf: null,
        });
      }
    }

    const results = Array.from(map.values()).sort((a, b) => {
      // Sort: open views first, then alphabetically
      if (a.isOpen && !b.isOpen) return -1;
      if (!a.isOpen && b.isOpen) return 1;
      return a.label.localeCompare(b.label);
    });

    console.debug(`[Dashboard][Discovery] Scan complete — found ${results.length} unique view types:`);
    results.forEach(v => {
      console.debug(`  [${v.isOpen ? 'OPEN' : 'closed'}][${v.location}] "${v.viewType}" -> "${v.label}" (${v.leafCount} leaves)`);
    });

    return results;
  }

  /**
   * Get all view types that plugins have REGISTERED (even if no leaf is open).
   * Uses the internal viewRegistry which exists on app in all Obsidian versions.
   */
  private getRegisteredViewTypes(): string[] {
    const appAny = this.app as any;
    const results: string[] = [];

    // Method 1: viewRegistry (exists in most versions)
    if (appAny.viewRegistry && appAny.viewRegistry.viewByType) {
      const types = Object.keys(appAny.viewRegistry.viewByType);
      console.debug('[Dashboard][Discovery] viewRegistry.viewByType keys:', types);
      results.push(...types);
    } else {
      console.warn('[Dashboard][Discovery] viewRegistry.viewByType not found — trying alternatives');
    }

    // Method 2: iterate enabled plugins and check for registerView calls
    // We cannot retroactively see registerView calls, but we can check
    // if plugins expose a known viewType property
    if (appAny.plugins && appAny.plugins.plugins) {
      for (const [pluginId, plugin] of Object.entries(appAny.plugins.plugins)) {
        const p = plugin as any;
        // Some plugins expose viewType as a static or instance property
        if (p.VIEW_TYPE) {
          console.debug(`[Dashboard][Discovery] Plugin "${pluginId}" exposes VIEW_TYPE="${p.VIEW_TYPE}"`);
          if (!results.includes(p.VIEW_TYPE)) results.push(p.VIEW_TYPE);
        }
        if (p.viewType) {
          console.debug(`[Dashboard][Discovery] Plugin "${pluginId}" exposes viewType="${p.viewType}"`);
          if (!results.includes(p.viewType)) results.push(p.viewType);
        }
      }
    }

    return [...new Set(results)]; // deduplicate
  }

  /**
   * Determine whether a leaf is in the root split, left sidedock, or right sidedock.
   */
  private getLeafLocation(leaf: WorkspaceLeaf): 'root' | 'left' | 'right' | 'unknown' {
    const ws = this.app.workspace as any;

    const isInSplit = (split: any, target: WorkspaceLeaf): boolean => {
      if (!split) return false;
      if (split === target) return true;
      if (split.children) {
        for (const child of split.children) {
          if (isInSplit(child, target)) return true;
        }
      }
      return false;
    };

    if (isInSplit(ws.rootSplit, leaf)) return 'root';
    if (isInSplit(ws.leftSplit, leaf)) return 'left';
    if (isInSplit(ws.rightSplit, leaf)) return 'right';
    return 'unknown';
  }

  /**
   * Turn a raw viewType string like "task-board-view" into a readable label.
   * Uses the leaf's own displayText if available, otherwise cleans up the viewType.
   */
  private makeLabel(viewType: string, displayText: string): string {
    // If displayText is the same as viewType (plugin didn't set a nice name),
    // clean up the viewType string into something readable
    if (displayText === viewType) {
      return viewType
        .replace(/-view$/, '')           // remove trailing "-view"
        .replace(/-/g, ' ')              // dashes to spaces
        .replace(/\b\w/g, c => c.toUpperCase()); // title case
    }
    return displayText;
  }

  /**
   * Get the best available leaf for a given viewType.
   * Preference: already-open leaf > create new one.
   */
  getBestLeafForViewType(viewType: string): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    console.debug(`[Dashboard][Discovery] getBestLeafForViewType("${viewType}") — found ${leaves.length} leaves`);
    if (leaves.length === 0) return null;
    // Prefer leaves that are not already hosted in the dashboard
    return leaves[0] ?? null;
  }
}