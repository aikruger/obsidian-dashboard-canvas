import { App, WorkspaceLeaf, WorkspaceParent, TFile } from 'obsidian';
import { WidgetConfig } from './widget-config';

/**
 * WorkspaceLeaf has internal .parent (WorkspaceParent) which has
 * .insertChild(index, item) and .removeChild(item) — not in public types
 * but confirmed present via diagnostic.
 */
type InternalLeaf = WorkspaceLeaf & {
  parent: InternalParent;
  containerEl: HTMLElement;
};

type InternalParent = WorkspaceParent & {
  children: InternalLeaf[];
  insertChild(index: number, item: unknown): void;
  removeChild(item: unknown): void;
  containerEl: HTMLElement;
};

export interface MountRecord {
  leaf: InternalLeaf;
  originalParent: InternalParent;
  originalIndex: number;
  owned: boolean;
}

export class WidgetManager {
  private app: App;
  // widgetId → mount record (where the leaf came from)
  private mounts: Map<string, MountRecord> = new Map();

  constructor(app: App) {
    this.app = app;
    console.debug('[Dashboard][WidgetManager] Constructed');
  }

  /**
   * Get a leaf for the given viewType.
   * Priority:
   *   1. Already mounted for this widgetId — return existing
   *   2. Existing leaf of viewType in workspace — use it
   *   3. Create a new one in the right sidebar
   */
  async getOrCreateLeaf(config: WidgetConfig): Promise<{ leaf: InternalLeaf | null; owned: boolean }> {
    console.debug(`[Dashboard][WidgetManager] getOrCreateLeaf: id="${config.id}" viewType="${config.viewType}"`);

    // Already mounted — return existing record
    if (this.mounts.has(config.id)) {
      console.debug(`[Dashboard][WidgetManager] Already mounted for "${config.id}", returning existing leaf`);
      const record = this.mounts.get(config.id)!;
      return { leaf: record.leaf, owned: record.owned };
    }

    const ws = this.app.workspace;

    // --- CANVAS ---
    if (config.viewType === 'canvas' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (!(file instanceof TFile)) {
        console.warn(`[Dashboard][WidgetManager] Canvas file not found: "${config.filePath}"`);
        return { leaf: null, owned: false };
      }
      const leaf = ws.getRightLeaf(false) as InternalLeaf | null;
      if (!leaf) { console.warn('[Dashboard][WidgetManager] Could not get right sidebar leaf for canvas'); return { leaf: null, owned: false }; }
      await leaf.openFile(file);
      console.debug(`[Dashboard][WidgetManager] Canvas leaf created for widget "${config.id}"`);
      return { leaf, owned: true };
    }

    // --- BASES ---
    if (config.viewType === 'bases' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (!(file instanceof TFile)) {
        console.warn(`[Dashboard][WidgetManager] Bases file not found: "${config.filePath}"`);
        return { leaf: null, owned: false };
      }
      const leaf = ws.getRightLeaf(false) as InternalLeaf | null;
      if (!leaf) {
        console.warn('[Dashboard][WidgetManager] Could not get right sidebar leaf for bases');
        return { leaf: null, owned: false };
      }
      await leaf.openFile(file);

      // Wait for Bases view to initialise — it's async
      let attempts = 0;
      while (attempts < 10) {
        const type = leaf.getViewState().type;
        if (type === 'bases') {
          console.debug(`[Dashboard][WidgetManager] Bases leaf ready after ${attempts * 100}ms, widget "${config.id}"`);
          break;
        }
        console.debug(`[Dashboard][WidgetManager] Waiting for bases view on "${config.filePath}" (attempt ${attempts + 1})...`);
        await sleep(100);
        attempts++;
      }

      if (leaf.getViewState().type !== 'bases') {
        console.warn(`[Dashboard][WidgetManager] Bases view never became ready for "${config.filePath}" — is Bases enabled?`);
        leaf.detach();
        return { leaf: null, owned: false };
      }

      console.debug(`[Dashboard][WidgetManager] Bases leaf created for widget "${config.id}", file="${config.filePath}"`);
      return { leaf, owned: true };
    }

    // --- PLUGIN VIEW ---
    if (config.viewType) {
      // Find existing
      const existing = ws.getLeavesOfType(config.viewType);
      if (existing.length > 0 && existing[0] !== undefined) {
        const leaf = existing[0] as InternalLeaf;
        console.debug(`[Dashboard][WidgetManager] Found existing leaf for viewType="${config.viewType}"`, leaf);
        return { leaf, owned: false };
      }

      // None found — create in right sidebar
      console.debug(`[Dashboard][WidgetManager] No existing leaf for "${config.viewType}", creating in right sidebar`);
      try {
        const newLeaf = ws.getRightLeaf(false) as InternalLeaf | null;
        if (!newLeaf) {
          console.warn(`[Dashboard][WidgetManager] getRightLeaf returned null for "${config.viewType}"`);
          return { leaf: null, owned: false };
        }
        await newLeaf.setViewState({
          type: config.viewType,
          active: false,
          state: (config as any).pluginState ?? {}
        });

        // Wait for the view to finish initialising (some plugins are async in onOpen)
        // Poll up to 10 times at 100ms intervals
        let attempts = 0;
        while (attempts < 10) {
          const viewType = newLeaf.getViewState().type;
          if (viewType === config.viewType) {
            console.debug(`[Dashboard][WidgetManager] Plugin view "${config.viewType}" ready after ${attempts * 100}ms`);
            break;
          }
          console.debug(`[Dashboard][WidgetManager] Waiting for "${config.viewType}" to initialise (attempt ${attempts + 1})...`);
          await sleep(100);
          attempts++;
        }

        if (newLeaf.getViewState().type !== config.viewType) {
          console.warn(`[Dashboard][WidgetManager] Plugin view "${config.viewType}" never became ready — leaf type is "${newLeaf.getViewState().type}"`);
          newLeaf.detach();
          return { leaf: null, owned: false };
        }

        console.debug(`[Dashboard][WidgetManager] New leaf created for "${config.viewType}"`);
        return { leaf: newLeaf, owned: true };
      } catch (err) {
        console.error(`[Dashboard][WidgetManager] Error creating leaf for "${config.viewType}":`, err);
        return { leaf: null, owned: false };
      }
    }

    return { leaf: null, owned: false };
  }

  /**
   * Mount a leaf into a dashboard widget slot.
   *
   * CORRECT APPROACH:
   *   1. Record the leaf's original parent + index in that parent's children array.
   *   2. Call parent.removeChild(leaf) — cleanly detaches from workspace tree + DOM.
   *   3. Physically append leaf.containerEl into the slot's content frame.
   *
   * We intentionally do NOT call insertChild on the dashboard's container,
   * because our canvas is not a WorkspaceParent — it's a plain div.
   * The leaf's workspace parent becomes "orphaned" (null after removeChild),
   * which is acceptable for the duration of the dashboard session.
   */
  mountLeaf(leaf: InternalLeaf, slotContentEl: HTMLElement, widgetId: string, owned: boolean): boolean {
    console.debug(`[Dashboard][WidgetManager] mountLeaf: widgetId="${widgetId}"`);

    if (this.mounts.has(widgetId)) {
      console.warn(`[Dashboard][WidgetManager] Widget "${widgetId}" already mounted — skipping`);
      return false;
    }

    const originalParent = leaf.parent as InternalParent;
    if (!originalParent) {
      console.warn(`[Dashboard][WidgetManager] Leaf for "${widgetId}" has no parent — may already be detached`);
    }

    // Record original position
    const originalIndex = originalParent && originalParent.children
      ? originalParent.children.indexOf(leaf)
      : 0;

    console.debug(`[Dashboard][WidgetManager] Original parent for "${widgetId}":`, originalParent, `index=${originalIndex}`);

    // Detach from workspace tree properly
    if (originalParent && typeof originalParent.removeChild === 'function') {
      console.debug(`[Dashboard][WidgetManager] Calling parent.removeChild for "${widgetId}"`);
      try {
        originalParent.removeChild(leaf);
        console.debug(`[Dashboard][WidgetManager] removeChild success for "${widgetId}"`);
      } catch (err) {
        console.warn(`[Dashboard][WidgetManager] removeChild threw for "${widgetId}" — falling back to raw DOM`, err);
      }
    } else {
      console.warn(`[Dashboard][WidgetManager] No removeChild available for "${widgetId}", using raw DOM only`);
    }

    // Move the containerEl into our slot
    slotContentEl.appendChild(leaf.containerEl);
    leaf.containerEl.style.cssText = 'width:100%;height:100%;overflow:auto;position:relative;';

    // Store the mount record
    this.mounts.set(widgetId, { leaf, originalParent, originalIndex, owned });
    console.debug(`[Dashboard][WidgetManager] mountLeaf complete for "${widgetId}"`);
    return true;
  }

  /**
   * Restore a leaf back to its original workspace location.
   *
   * Uses insertChild(originalIndex, leaf) to put it back into the correct
   * WorkspaceParent at the correct tab position — exactly what Obsidian's
   * drag system does internally.
   */
  restoreLeaf(widgetId: string): void {
    console.debug(`[Dashboard][WidgetManager] restoreLeaf: widgetId="${widgetId}"`);

    const record = this.mounts.get(widgetId);
    if (!record) {
      console.warn(`[Dashboard][WidgetManager] No mount record for "${widgetId}"`);
      return;
    }

    const { leaf, originalParent, originalIndex, owned } = record;

    if (owned) {
      console.debug(`[Dashboard][WidgetManager] Dashboard-owned leaf — detaching for widget "${widgetId}"`);
      leaf.detach();
    } else if (originalParent && typeof originalParent.insertChild === 'function') {
      try {
        originalParent.insertChild(originalIndex, leaf);
        console.debug(`[Dashboard][WidgetManager] insertChild restore success for "${widgetId}" at index ${originalIndex}`);
      } catch (err) {
        console.warn(`[Dashboard][WidgetManager] insertChild failed for "${widgetId}" — falling back to detach`, err);
        leaf.detach();
      }
    } else {
      // Parent is gone (e.g. user closed the pane) — put leaf in right sidebar
      console.warn(`[Dashboard][WidgetManager] Original parent gone for "${widgetId}" — restoring to right sidebar`);
      const fallbackLeaf = this.app.workspace.getRightLeaf(false) as InternalLeaf | null;
      if (fallbackLeaf && fallbackLeaf.parent) {
        const fp = fallbackLeaf.parent as InternalParent;
        try {
          fp.insertChild(0, leaf);
          console.debug(`[Dashboard][WidgetManager] Fallback restore to right sidebar for "${widgetId}"`);
        } catch (err2) {
          console.error(`[Dashboard][WidgetManager] Fallback insertChild also failed for "${widgetId}"`, err2);
          leaf.detach();
        }
      } else {
        leaf.detach();
      }
    }

    this.mounts.delete(widgetId);
    console.debug(`[Dashboard][WidgetManager] restoreLeaf complete for "${widgetId}"`);
  }

  restoreAll(): void {
    console.debug(`[Dashboard][WidgetManager] restoreAll — ${this.mounts.size} widgets to restore`);
    for (const widgetId of Array.from(this.mounts.keys())) {
      this.restoreLeaf(widgetId);
    }
    console.debug('[Dashboard][WidgetManager] restoreAll complete');
  }

  getMountedLeaf(widgetId: string): InternalLeaf | null {
    return this.mounts.get(widgetId)?.leaf ?? null;
  }

  getMounts() {
      return this.mounts;
  }

  async fallbackRenderWidget(config: WidgetConfig, hostEl: HTMLElement): Promise<boolean> {
    console.debug(`[Dashboard][WidgetManager] FALLBACK render for widget "${config.id}", viewType="${config.viewType}"`);

    // For markdown-type widgets, use the vault + MarkdownRenderer pipeline
    if (config.viewType === 'markdown' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (!file) {
        console.warn(`[Dashboard][WidgetManager] File not found: "${config.filePath}"`);
        return false;
      }

      try {
        const { MarkdownRenderer } = require('obsidian');
        const content = await this.app.vault.cachedRead(file as any);

        console.debug(`[Dashboard][WidgetManager] Rendering markdown for "${config.filePath}", length=${content.length}`);

        hostEl.empty();
        const renderEl = hostEl.createDiv({ cls: 'dashboard-markdown-render' });

        await MarkdownRenderer.render(
          this.app,
          content,
          renderEl,
          (file as any).path,
          null as any
        );

        console.debug(`[Dashboard][WidgetManager] Markdown render complete for "${config.filePath}"`);
        return true;
      } catch (err) {
        console.error(`[Dashboard][WidgetManager] Markdown render FAILED:`, err);
        return false;
      }
    }

    // For other view types, show a "click to open in sidebar" button
    console.debug(`[Dashboard][WidgetManager] No fallback available for viewType="${config.viewType}" — showing launcher`);
    const launchBtn = hostEl.createEl('button', {
      text: `▶ Open ${config.label}`,
      cls: 'dashboard-launch-btn'
    });
    launchBtn.addEventListener('click', () => {
      console.debug(`[Dashboard][WidgetManager] Launch button clicked for "${config.viewType}"`);
      // Use standard cast since config doesn't have an openCommandId currently in our WidgetConfig.
      // this.app.commands.executeCommandById(config.openCommandId || '');
    });
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}