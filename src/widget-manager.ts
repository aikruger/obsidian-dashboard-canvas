import { App, WorkspaceLeaf } from 'obsidian';
import { WidgetConfig } from './widget-config';

// Internal types — not in public Obsidian API but confirmed by diagnostics
type InternalLeaf = WorkspaceLeaf & {
  parent: InternalParent;
  containerEl: HTMLElement;
  tabHeaderEl?: HTMLElement;
  view?: { getDisplayText?: () => string };
};

type InternalParent = {
  children: InternalLeaf[];
  containerEl: HTMLElement;
  replaceChild(index: number, newLeaf: InternalLeaf): void;
  insertChild(index: number, leaf: InternalLeaf): void;
  removeChild(leaf: InternalLeaf): void;
  recomputeChildrenDimensions(): void;
  updateTabDisplay(): void;
  lockTabWidths?(): void;
  unlockTabWidths?(): void;
  selectTab?(leaf: InternalLeaf): void;
};

export interface MountRecord {
  leaf: InternalLeaf;
  originalParent: InternalParent;
  placeholder: InternalLeaf;
  tabGroupEl?: HTMLElement;
  originalTabGroupNext?: ChildNode | null;
}

export class WidgetManager {
  private app: App;
  private mounts: Map<string, MountRecord> = new Map();
  private resizeObservers: Map<string, ResizeObserver> = new Map();

  constructor(app: App) {
    this.app = app;
    console.debug('[Dashboard][WidgetManager] Constructed');
  }

  // ─────────────────────────────────────────────
  // Acquire a leaf for the given widget config
  // ─────────────────────────────────────────────
  async getOrCreateLeaf(config: WidgetConfig): Promise<InternalLeaf | null> {
    console.debug(`[Dashboard][WidgetManager] getOrCreateLeaf: id="${config.id}" viewType="${config.viewType}"`);

    // Already mounted — return existing
    if (this.mounts.has(config.id)) {
      console.debug(`[Dashboard][WidgetManager] Already mounted "${config.id}", returning existing`);
      return this.mounts.get(config.id)!.leaf;
    }

    // Find existing open leaf of this view type
    const existing = this.app.workspace.getLeavesOfType(config.viewType);
    if (existing.length > 0 && existing[0] !== undefined) {
      console.debug(`[Dashboard][WidgetManager] Found ${existing.length} existing leaf(ves) for "${config.viewType}", using first`);
      return existing[0] as InternalLeaf;
    }

    // None open — create one in right sidebar
    console.debug(`[Dashboard][WidgetManager] No existing leaf for "${config.viewType}", creating in right sidebar`);
    try {
      const newLeaf = this.app.workspace.getRightLeaf(false) as InternalLeaf | null;
      if (!newLeaf) {
        console.warn(`[Dashboard][WidgetManager] getRightLeaf returned null for "${config.viewType}"`);
        return null;
      }
      await newLeaf.setViewState({ type: config.viewType, active: false });
      // Give the plugin one render cycle to initialise its view
      await sleep(150);
      console.debug(`[Dashboard][WidgetManager] New leaf created and initialised for "${config.viewType}"`);
      return newLeaf;
    } catch (err) {
      console.error(`[Dashboard][WidgetManager] Error creating leaf for "${config.viewType}":`, err);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // Mount a leaf into a dashboard widget slot
  // ─────────────────────────────────────────────
  async mountLeaf(
    leaf: InternalLeaf,
    slotContentEl: HTMLElement,
    widgetId: string,
    widgetLabel: string
  ): Promise<boolean> {
    console.debug(`[Dashboard][WidgetManager] mountLeaf (workspace-native): widgetId="${widgetId}"`);

    if (this.mounts.has(widgetId)) {
      console.warn(`[Dashboard][WidgetManager] Already mounted "${widgetId}" — skipping duplicate mount`);
      return false;
    }

    const originalParent = leaf.parent as InternalParent;
    if (!originalParent) {
      console.warn(`[Dashboard][WidgetManager] Leaf for "${widgetId}" has no parent — cannot mount`);
      return false;
    }

    // ── Step 1: Create a new WorkspaceTabs container ──
    // This gives the leaf a proper WorkspaceParent — exactly like a real tab
    const ws = this.app.workspace as any;

    // createLeafBySplit creates a new tab group and returns a leaf inside it
    // We then move the TAB GROUP's containerEl into our slot, not just the leaf's containerEl
    const tempLeaf = ws.createLeafBySplit(leaf, 'vertical', false) as InternalLeaf;
    console.log(`[Dashboard][WidgetManager] tempLeaf created alongside "${widgetId}"`);

    // The tab group (WorkspaceTabs) is the shared parent of both leaf and tempLeaf
    const tabGroup = leaf.parent as InternalParent;
    const tabGroupEl = tabGroup.containerEl;

    // ── Step 2: Close the temp leaf (we only needed it to create the tab group) ──
    // Now leaf is alone in the tab group
    try { tempLeaf.detach(); } catch {}

    // ── Step 3: Store original parent BEFORE we move the tab group ──
    const originalTabGroupParent = tabGroupEl.parentElement;
    const originalTabGroupNext = tabGroupEl.nextSibling;
    this.mounts.set(widgetId, {
      leaf,
      originalParent: originalTabGroupParent as unknown as InternalParent,
      placeholder: null as any, // not using placeholder in this approach
      tabGroupEl,
      originalTabGroupNext,
    });

    // ── Step 4: Move the entire tab group DOM into the slot ──
    tabGroupEl.style.width = '100%';
    tabGroupEl.style.height = '100%';
    tabGroupEl.style.position = 'relative';
    slotContentEl.appendChild(tabGroupEl);

    console.log(`[Dashboard][WidgetManager] Tab group containerEl mounted for "${widgetId}"`);
    console.log(`[Dashboard][WidgetManager] view-actions count:`,
      tabGroupEl.querySelectorAll('.view-action').length);

    // ── Step 5: Attach ResizeObserver so the view re-renders on slot resize ──
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        console.log(`[Dashboard][WidgetManager] ResizeObserver fired for "${widgetId}", new size:`,
          Math.round(entry.contentRect.width), 'x', Math.round(entry.contentRect.height));
        // Call onResize on the leaf's view directly
        const view = leaf.view as any;
        if (typeof view?.onResize === 'function') {
          try {
            view.onResize();
          } catch (err) {
            console.warn(`[Dashboard][WidgetManager] ResizeObserver: onResize() threw for "${widgetId}":`, err);
          }
        }
        // FullCalendar-specific
        const cal = view?.calendar ?? view?.fullCalendar ?? view?._calendar ?? view?.fullCalendarStore?.calendar ?? null;
        if (cal) {
          try { cal.updateSize?.(); } catch {}
        }
      }
    });
    ro.observe(slotContentEl);
    this.resizeObservers.set(widgetId, ro);
    console.log(`[Dashboard][WidgetManager] ResizeObserver attached for "${widgetId}"`);

    console.debug(`[Dashboard][WidgetManager] mountLeaf complete for "${widgetId}"`);
    return true;
  }

  // ─────────────────────────────────────────────
  // Restore a leaf back to its original tab slot
  // ─────────────────────────────────────────────
  restoreLeaf(widgetId: string): void {
    const record = this.mounts.get(widgetId);
    if (!record) return;

    const { leaf, tabGroupEl, originalParent, originalTabGroupNext } = record;

    if (tabGroupEl && originalParent) {
      // Re-insert the tab group at its original position
      (originalParent as unknown as HTMLElement).insertBefore(
        tabGroupEl,
        originalTabGroupNext ?? null
      );
      console.log(`[Dashboard][WidgetManager] Tab group restored for "${widgetId}"`);
      // Trigger layout recalculation
      const ws = this.app.workspace as any;
      ws.onLayoutChange?.();
    } else {
      this._fallbackRestore(leaf, widgetId);
    }

    const ro = this.resizeObservers.get(widgetId);
    if (ro) { ro.disconnect(); this.resizeObservers.delete(widgetId); }
    this.mounts.delete(widgetId);
  }

  private _fallbackRestore(leaf: InternalLeaf, widgetId: string): void {
    console.debug(`[Dashboard][WidgetManager] _fallbackRestore for "${widgetId}"`);
    try {
      const rightLeaf = this.app.workspace.getRightLeaf(false) as InternalLeaf | null;
      if (rightLeaf?.parent) {
        const rp = rightLeaf.parent as InternalParent;
        rp.insertChild(0, leaf);
        rp.recomputeChildrenDimensions?.();
        rp.updateTabDisplay?.();
        console.debug(`[Dashboard][WidgetManager] Fallback: restored "${widgetId}" to right sidebar`);
      } else {
        leaf.detach();
        console.debug(`[Dashboard][WidgetManager] Fallback: detached "${widgetId}"`);
      }
    } catch (err) {
      console.error(`[Dashboard][WidgetManager] _fallbackRestore threw for "${widgetId}":`, err);
      try { leaf.detach(); } catch {}
    }
  }

  restoreAll(): void {
    const count = this.mounts.size;
    console.debug(`[Dashboard][WidgetManager] restoreAll — restoring ${count} widget(s)`);
    for (const widgetId of Array.from(this.mounts.keys())) {
      this.restoreLeaf(widgetId);
    }
    console.debug(`[Dashboard][WidgetManager] restoreAll complete`);
  }

  getMountedLeaf(widgetId: string): InternalLeaf | null {
    return this.mounts.get(widgetId)?.leaf ?? null;
  }

  isMounted(widgetId: string): boolean {
    return this.mounts.has(widgetId);
  }

  getMounts() {
    return this.mounts;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
