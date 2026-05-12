import { App, WorkspaceLeaf, TFile } from 'obsidian';
import { WidgetConfig } from './widget-config';

export class WidgetManager {
  private app: App;
  // Map from widgetId → the leaf that has been "stolen" for that widget
  private mountedLeaves: Map<string, WorkspaceLeaf> = new Map();
  // Map from widgetId → the original parent container reference
  private originalParents: Map<string, { parent: HTMLElement; next: ChildNode | null }> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Acquire a leaf for a given config.
   * Priority:
   * 1. The leaf is already mounted to this widget — return it.
   * 2. An existing leaf of the right viewType exists in the workspace.
   * 3. Create a new leaf in the right sidebar (hidden), set its view type,
   *    wait for it to initialise, then proceed.
   */
  async getOrCreateLeaf(config: WidgetConfig): Promise<WorkspaceLeaf | null> {
    console.debug(`[Dashboard][WidgetManager] getOrCreateLeaf for widget "${config.id}", viewType="${config.viewType}"`);

    if (this.mountedLeaves.has(config.id)) {
      console.debug(`[Dashboard][WidgetManager] Leaf already mounted for "${config.id}", reusing`);
      return this.mountedLeaves.get(config.id)!;
    }

    const { workspace } = this.app;

    // Special handling for markdown notes
    if (config.viewType === 'markdown' && config.filePath) {
      const file = this.app.vault.getAbstractFileByPath(config.filePath);
      if (file instanceof TFile) {
        console.debug(`[Dashboard][WidgetManager] Opening markdown note "${config.filePath}"`);
        const leaf = workspace.getLeaf(false);
        await leaf.openFile(file);
        return leaf;
      } else {
        console.warn(`[Dashboard][WidgetManager] Could not find markdown file "${config.filePath}"`);
        return null;
      }
    }

    // Check for existing leaf of this view type
    const existingLeaves = workspace.getLeavesOfType(config.viewType);
    if (existingLeaves.length > 0 && existingLeaves[0] !== undefined) {
      console.debug(`[Dashboard][WidgetManager] Found ${existingLeaves.length} existing leaf(ves) for viewType "${config.viewType}", using first`);
      return existingLeaves[0];
    }

    // No existing leaf — create one in right sidebar (minimally visible)
    console.debug(`[Dashboard][WidgetManager] No existing leaf for "${config.viewType}", creating in right sidebar`);
    try {
      const newLeaf = workspace.getRightLeaf(false);
      if (!newLeaf) {
        console.warn(`[Dashboard][WidgetManager] Could not get right sidebar leaf for "${config.viewType}"`);
        return null;
      }
      await newLeaf.setViewState({ type: config.viewType });
      console.debug(`[Dashboard][WidgetManager] New leaf created for "${config.viewType}"`);
      return newLeaf;
    } catch (err) {
      console.error(`[Dashboard][WidgetManager] Error creating leaf for "${config.viewType}":`, err);
      return null;
    }
  }

  /**
   * Mount a leaf's DOM into a widget slot container.
   * Saves the original parent/sibling so we can restore later.
   */
  mountLeaf(leaf: WorkspaceLeaf, slotContentEl: HTMLElement, widgetId: string): boolean {
    console.debug(`[Dashboard][WidgetManager] Mounting leaf for widget "${widgetId}"`);

    const containerEl = (leaf as unknown as { containerEl?: HTMLElement }).containerEl;
    if (!containerEl) {
      console.warn(`[Dashboard][WidgetManager] leaf.containerEl is null for widget "${widgetId}"`);
      return false;
    }

    // Save original location
    const originalParent = containerEl.parentElement;
    const originalNext = containerEl.nextSibling;

    if (!originalParent) {
      console.warn(`[Dashboard][WidgetManager] containerEl has no parentElement for "${widgetId}" — might already be detached`);
    } else {
      this.originalParents.set(widgetId, { parent: originalParent, next: originalNext });
    }

    // Move into slot
    slotContentEl.appendChild(containerEl);
    this.mountedLeaves.set(widgetId, leaf);

    // Force the leaf's container to fill the slot
    containerEl.style.cssText = 'width:100%;height:100%;overflow:auto;position:relative;';

    console.debug(`[Dashboard][WidgetManager] Leaf mounted for widget "${widgetId}"`);
    return true;
  }

  /**
   * Restore a leaf back to its original DOM position.
   */
  restoreLeaf(widgetId: string): void {
    console.debug(`[Dashboard][WidgetManager] Restoring leaf for widget "${widgetId}"`);
    const leaf = this.mountedLeaves.get(widgetId);
    const originalLocation = this.originalParents.get(widgetId);

    if (!leaf) {
      console.warn(`[Dashboard][WidgetManager] No mounted leaf found for "${widgetId}"`);
      return;
    }

    const containerEl = (leaf as unknown as { containerEl: HTMLElement }).containerEl;

    if (originalLocation && originalLocation.parent) {
      originalLocation.parent.insertBefore(containerEl, originalLocation.next);
      console.debug(`[Dashboard][WidgetManager] Leaf for "${widgetId}" restored to original parent`);
    } else {
      // No original location — put back in right sidebar
      const { workspace } = this.app;
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        (rightLeaf as unknown as { containerEl: HTMLElement }).containerEl.parentElement?.appendChild(containerEl);
        console.debug(`[Dashboard][WidgetManager] Leaf for "${widgetId}" moved to right sidebar fallback`);
      } else {
        // Last resort — detach the leaf entirely
        leaf.detach();
        console.debug(`[Dashboard][WidgetManager] Leaf for "${widgetId}" detached (fallback)`);
      }
    }

    this.mountedLeaves.delete(widgetId);
    this.originalParents.delete(widgetId);
  }

  restoreAll(): void {
    console.debug(`[Dashboard][WidgetManager] Restoring all mounted leaves (${this.mountedLeaves.size})`);
    for (const widgetId of Array.from(this.mountedLeaves.keys())) {
      this.restoreLeaf(widgetId);
    }
  }
}
