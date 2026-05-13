import { App, WorkspaceLeaf, TFile } from 'obsidian';
import { WidgetConfig } from './widget-config';

export class WidgetManager {
  private app: App;
  private mountedLeaves: Map<string, WorkspaceLeaf> = new Map();
  private originalParents: Map<string, { parent: HTMLElement; next: ChildNode | null }> = new Map();
  private ownedLeaves: Set<string> = new Set();

  constructor(app: App) {
    this.app = app;
  }

  async getOrCreateLeaf(config: WidgetConfig): Promise<WorkspaceLeaf | null> {
    console.debug(`[Dashboard][WidgetManager] getOrCreateLeaf — widget="${config.id}", kind="${config.kind}", viewType="${config.viewType}"`);

    if (this.mountedLeaves.has(config.id)) {
      console.debug(`[Dashboard][WidgetManager] Reusing already-mounted leaf for widget "${config.id}"`);
      return this.mountedLeaves.get(config.id)!;
    }

    const { workspace } = this.app;

    // --- MARKDOWN ---
    if (config.kind === 'markdown' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (!(file instanceof TFile)) {
        console.warn(`[Dashboard][WidgetManager] Markdown file not found: "${config.filePath}"`);
        return null;
      }
      const leaf = workspace.getRightLeaf(false);
      if (!leaf) { console.warn('[Dashboard][WidgetManager] Could not get right sidebar leaf for markdown'); return null; }
      await leaf.openFile(file);
      this.ownedLeaves.add(config.id);
      console.debug(`[Dashboard][WidgetManager] Markdown leaf created for widget "${config.id}"`);
      return leaf;
    }

    // --- CANVAS ---
    if (config.kind === 'canvas' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (!(file instanceof TFile)) {
        console.warn(`[Dashboard][WidgetManager] Canvas file not found: "${config.filePath}"`);
        return null;
      }
      const leaf = workspace.getRightLeaf(false);
      if (!leaf) { console.warn('[Dashboard][WidgetManager] Could not get right sidebar leaf for canvas'); return null; }
      await leaf.openFile(file);
      this.ownedLeaves.add(config.id);
      console.debug(`[Dashboard][WidgetManager] Canvas leaf created for widget "${config.id}"`);
      return leaf;
    }

    // --- BASES ---
    if (config.kind === 'bases' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (!(file instanceof TFile)) {
        console.warn(`[Dashboard][WidgetManager] Bases file not found: "${config.filePath}"`);
        return null;
      }
      const leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        console.warn('[Dashboard][WidgetManager] Could not get right sidebar leaf for bases');
        return null;
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
        await new Promise(resolve => window.setTimeout(resolve, 100));
        attempts++;
      }

      if (leaf.getViewState().type !== 'bases') {
        console.warn(`[Dashboard][WidgetManager] Bases view never became ready for "${config.filePath}" — is Bases enabled?`);
        leaf.detach();
        return null;
      }

      this.ownedLeaves.add(config.id);
      console.debug(`[Dashboard][WidgetManager] Bases leaf created for widget "${config.id}", file="${config.filePath}"`);
      return leaf;
    }

    // --- PLUGIN VIEW ---
    if (config.kind === 'plugin') {
      const leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        console.warn(`[Dashboard][WidgetManager] Could not get right sidebar leaf for plugin view "${config.viewType}"`);
        return null;
      }
      try {
        await leaf.setViewState({
          type: config.viewType,
          state: (config.pluginState ?? {}) as Record<string, unknown>
        });

        // Wait for the view to finish initialising (some plugins are async in onOpen)
        // Poll up to 10 times at 100ms intervals
        let attempts = 0;
        while (attempts < 10) {
          const viewType = leaf.getViewState().type;
          if (viewType === config.viewType) {
            console.debug(`[Dashboard][WidgetManager] Plugin view "${config.viewType}" ready after ${attempts * 100}ms`);
            break;
          }
          console.debug(`[Dashboard][WidgetManager] Waiting for "${config.viewType}" to initialise (attempt ${attempts + 1})...`);
          await new Promise(resolve => window.setTimeout(resolve, 100));
          attempts++;
        }

        if (leaf.getViewState().type !== config.viewType) {
          console.warn(`[Dashboard][WidgetManager] Plugin view "${config.viewType}" never became ready — leaf type is "${leaf.getViewState().type}"`);
          leaf.detach();
          return null;
        }

        this.ownedLeaves.add(config.id);
        console.debug(`[Dashboard][WidgetManager] Plugin view leaf ready for "${config.viewType}", widget "${config.id}"`);
        return leaf;
      } catch (err) {
        console.error(`[Dashboard][WidgetManager] setViewState failed for "${config.viewType}" (plugin not loaded?):`, err);
        return null;
      }
    }

    console.warn(`[Dashboard][WidgetManager] No handler matched for widget "${config.id}", kind="${config.kind}"`);
    return null;
  }

  mountLeaf(leaf: WorkspaceLeaf, slotContentEl: HTMLElement, widgetId: string): boolean {
    console.debug(`[Dashboard][WidgetManager] Mounting leaf into widget "${widgetId}"`);
    const containerEl = (leaf as unknown as { containerEl?: HTMLElement }).containerEl;
    if (!containerEl) {
      console.warn(`[Dashboard][WidgetManager] leaf.containerEl is null for widget "${widgetId}"`);
      return false;
    }
    const originalParent = containerEl.parentElement;
    const originalNext = containerEl.nextSibling;
    if (originalParent) {
      this.originalParents.set(widgetId, { parent: originalParent, next: originalNext });
    } else {
      console.warn(`[Dashboard][WidgetManager] containerEl has no parentElement for widget "${widgetId}"`);
    }
    slotContentEl.appendChild(containerEl);
    containerEl.style.cssText = 'width:100%;height:100%;overflow:auto;position:relative;';
    this.mountedLeaves.set(widgetId, leaf);
    console.debug(`[Dashboard][WidgetManager] Leaf mounted for widget "${widgetId}"`);
    return true;
  }

  restoreLeaf(widgetId: string): void {
    console.debug(`[Dashboard][WidgetManager] restoreLeaf called for widget "${widgetId}"`);
    const leaf = this.mountedLeaves.get(widgetId);
    if (!leaf) {
      console.warn(`[Dashboard][WidgetManager] No mounted leaf found for widget "${widgetId}"`);
      return;
    }

    if (this.ownedLeaves.has(widgetId)) {
      console.debug(`[Dashboard][WidgetManager] Dashboard-owned leaf — detaching for widget "${widgetId}"`);
      leaf.detach();
    } else {
      const originalLocation = this.originalParents.get(widgetId);
      const containerEl = (leaf as unknown as { containerEl: HTMLElement }).containerEl;
      if (originalLocation?.parent) {
        originalLocation.parent.insertBefore(containerEl, originalLocation.next);
        console.debug(`[Dashboard][WidgetManager] Leaf restored to original parent for widget "${widgetId}"`);
      } else {
        leaf.detach();
        console.debug(`[Dashboard][WidgetManager] Leaf detached (no original parent) for widget "${widgetId}"`);
      }
    }

    this.mountedLeaves.delete(widgetId);
    this.originalParents.delete(widgetId);
    this.ownedLeaves.delete(widgetId);
    console.debug(`[Dashboard][WidgetManager] restoreLeaf complete for widget "${widgetId}"`);
  }

  restoreAll(): void {
    console.debug(`[Dashboard][WidgetManager] restoreAll — ${this.mountedLeaves.size} widgets to restore`);
    for (const widgetId of Array.from(this.mountedLeaves.keys())) {
      this.restoreLeaf(widgetId);
    }
    console.debug('[Dashboard][WidgetManager] restoreAll complete');
  }
}