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
    console.debug(`[Dashboard][WidgetManager] mountLeaf: widgetId="${widgetId}"`);

    if (this.mounts.has(widgetId)) {
      console.warn(`[Dashboard][WidgetManager] Already mounted "${widgetId}" — skipping duplicate mount`);
      return false;
    }

    const originalParent = leaf.parent as InternalParent;
    if (!originalParent) {
      console.warn(`[Dashboard][WidgetManager] Leaf for "${widgetId}" has no parent — cannot mount`);
      return false;
    }

    const leafIdx = originalParent.children.indexOf(leaf);
    console.debug(`[Dashboard][WidgetManager] "${widgetId}": leaf at idx=${leafIdx}, parent has ${originalParent.children.length} children`);

    // ── Step 1: Insert placeholder at leafIdx (leaf shifts to leafIdx+1) ──
    const ws = this.app.workspace as any;
    let placeholder: InternalLeaf;
    try {
      placeholder = ws.createLeafInParent(originalParent, leafIdx) as InternalLeaf;
      console.debug(`[Dashboard][WidgetManager] Placeholder at idx=${originalParent.children.indexOf(placeholder)}, leaf now at idx=${originalParent.children.indexOf(leaf)}`);
    } catch (err) {
      console.error(`[Dashboard][WidgetManager] createLeafInParent failed for "${widgetId}":`, err);
      return false;
    }

    // ── Step 2: Label the placeholder so user knows where the view went ──
    try {
      await placeholder.setViewState({ type: 'empty', state: {} });
      const viewContent = placeholder.containerEl.querySelector('.view-content') as HTMLElement;
      if (viewContent) {
        viewContent.style.cssText = [
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'flex-direction:column',
          'gap:8px',
          'color:var(--text-muted)',
          'font-size:13px',
          'text-align:center',
          'padding:24px',
        ].join(';');
        viewContent.innerHTML = `
          <span style="font-size:28px">📌</span>
          <strong style="color:var(--text-normal)">${widgetLabel}</strong>
          <span>Open in Dashboard Canvas</span>
          <span style="font-size:11px;color:var(--text-faint)">Close the dashboard to return this view here</span>
        `;
      }
      console.debug(`[Dashboard][WidgetManager] Placeholder content set for "${widgetId}"`);
    } catch (err) {
      console.warn(`[Dashboard][WidgetManager] Could not set placeholder content for "${widgetId}":`, err);
      // Non-fatal — placeholder will just be blank
    }

    // ── Step 3: Remove the real leaf (placeholder holds the tab slot) ──
    try {
      originalParent.removeChild(leaf);
      originalParent.recomputeChildrenDimensions();
      originalParent.updateTabDisplay();
      console.debug(`[Dashboard][WidgetManager] removeChild success for "${widgetId}", placeholder at idx=${originalParent.children.indexOf(placeholder)}`);
    } catch (err) {
      console.error(`[Dashboard][WidgetManager] removeChild failed for "${widgetId}":`, err);
      // Clean up placeholder
      try { placeholder.detach(); } catch {}
      return false;
    }

    // ── Step 4: Move leaf's containerEl into the widget slot ──
    leaf.containerEl.style.cssText = 'width:100%;height:100%;overflow:auto;position:relative;';
    slotContentEl.appendChild(leaf.containerEl);
    console.debug(`[Dashboard][WidgetManager] containerEl mounted into slot for "${widgetId}"`);

    // ── Step 5: Store mount record ──
    this.mounts.set(widgetId, { leaf, originalParent, placeholder });

    // ── Step 6: Attach ResizeObserver so the view re-renders on slot resize ──
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
        const cal = view?.calendar ?? view?.fullCalendar ?? view?.calendarEl?._calendar;
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
    console.debug(`[Dashboard][WidgetManager] restoreLeaf: widgetId="${widgetId}"`);

    // Disconnect ResizeObserver
    const ro = this.resizeObservers.get(widgetId);
    if (ro) {
      ro.disconnect();
      this.resizeObservers.delete(widgetId);
      console.log(`[Dashboard][WidgetManager] ResizeObserver disconnected for "${widgetId}"`);
    }

    const record = this.mounts.get(widgetId);
    if (!record) {
      console.warn(`[Dashboard][WidgetManager] No mount record for "${widgetId}" — nothing to restore`);
      return;
    }

    const { leaf, originalParent, placeholder } = record;

    // Re-read placeholder index dynamically — tabs may have been opened/closed
    const pidx = originalParent.children.indexOf(placeholder);
    console.debug(`[Dashboard][WidgetManager] "${widgetId}": placeholder at idx=${pidx}, parent has ${originalParent.children.length} children`);

    if (pidx === -1) {
      console.warn(`[Dashboard][WidgetManager] Placeholder no longer in parent for "${widgetId}" — using fallback restore`);
      this._fallbackRestore(leaf, widgetId);
      this.mounts.delete(widgetId);
      return;
    }

    try {
      // replaceChild(index, newLeaf): replaces placeholder at pidx with real leaf
      // internally calls placeholder.setParent(null) — orphans placeholder
      originalParent.replaceChild(pidx, leaf);
      originalParent.recomputeChildrenDimensions();
      originalParent.updateTabDisplay();

      // Remove orphaned placeholder DOM (setParent(null) was called but DOM lingers)
      placeholder.containerEl?.remove();

      // Restore focus without stealing keyboard
      this.app.workspace.setActiveLeaf(leaf, { focus: false });

      console.debug(`[Dashboard][WidgetManager] restoreLeaf complete for "${widgetId}" at idx=${pidx}`);
    } catch (err) {
      console.error(`[Dashboard][WidgetManager] replaceChild failed for "${widgetId}":`, err);
      this._fallbackRestore(leaf, widgetId);
    }

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
