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
    console.debug(`[Dashboard][WidgetManager] getOrCreateLeaf: id="${config.id}" viewType="${config.viewType}" filePath="${config.filePath ?? 'n/a'}"`);

    // Check if this exact viewType (+ filePath for file-based views) is already mounted
    for (const [mountedId, record] of this.mounts.entries()) {
      const mountedVs = record.leaf.getViewState();
      const mountedType = mountedVs.type;
      const mountedFile = (mountedVs.state as any)?.file as string | undefined;

      const typeMatch = mountedType === config.viewType;
      const fileMatch = config.filePath
        ? mountedFile === config.filePath
        : true;

      if (typeMatch && fileMatch) {
        console.warn(`[Dashboard][WidgetManager] viewType "${config.viewType}" already mounted as widget "${mountedId}" — returning that leaf`);
        return record.leaf;
      }
    }

    // Already mounted under THIS widget id
    if (this.mounts.has(config.id)) {
      console.log(`[Dashboard][WidgetManager] Returning already-mounted leaf for "${config.id}"`);
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
    console.log(`[Dashboard][WidgetManager] mountLeaf: widgetId="${widgetId}", viewType="${leaf.getViewState().type}"`);

    if (this.mounts.has(widgetId)) {
      console.warn(`[Dashboard][WidgetManager] Already mounted "${widgetId}" — skipping`);
      return false;
    }

    const containerEl = leaf.containerEl;
    if (!containerEl) {
      console.warn(`[Dashboard][WidgetManager] leaf.containerEl is null for "${widgetId}"`);
      return false;
    }

    // Save the DIRECT DOM parent and next sibling so we can restore later
    const originalDomParent = containerEl.parentElement;
    const originalDomNext = containerEl.nextSibling;

    this.mounts.set(widgetId, {
      leaf,
      originalParent: originalDomParent as unknown as InternalParent,
      placeholder: null as any,
      tabGroupEl: containerEl,           // reuse field — stores the element we moved
      originalTabGroupNext: originalDomNext,
    });

    // Force the containerEl to fill the slot and hide workspace chrome
    containerEl.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      position: absolute !important;
      top: 0; left: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;

    // Hide the workspace tab header (the bar that says "Full Calendar" etc.)
    // — it is the first child of containerEl with class workspace-leaf-content's parent header
    const tabHeader = containerEl.querySelector('.workspace-tab-header-container, .view-header');
    if (tabHeader) {
      (tabHeader as HTMLElement).style.display = 'none';
      console.log(`[Dashboard][WidgetManager] Tab header hidden for "${widgetId}"`);
    }

    // Move into slot
    slotContentEl.style.position = 'relative';
    slotContentEl.style.overflow = 'hidden';
    slotContentEl.appendChild(containerEl);

    console.log(`[Dashboard][WidgetManager] containerEl moved into slot for "${widgetId}"`);

    // Force layout recalculation on the leaf's view
    const view = leaf.view as any;
    if (typeof view?.onResize === 'function') {
      try { view.onResize(); } catch {}
    }

    // Attach ResizeObserver so view reflows when widget is resized
    const ro = new ResizeObserver(() => {
      console.log(`[Dashboard][WidgetManager] ResizeObserver: resize for "${widgetId}"`);
      const v = leaf.view as any;
      if (typeof v?.onResize === 'function') {
        try { v.onResize(); } catch {}
      }
      // FullCalendar-specific updateSize
      const cal = v?.calendar ?? v?.fullCalendar ?? v?._calendar ?? v?.fullCalendarStore?.calendar ?? null;
      if (cal && typeof cal.updateSize === 'function') {
        try { cal.updateSize(); } catch {}
      }
    });
    ro.observe(slotContentEl);
    this.resizeObservers.set(widgetId, ro);

    console.log(`[Dashboard][WidgetManager] mountLeaf complete for "${widgetId}"`);
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
