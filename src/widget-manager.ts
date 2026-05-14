import { App, WorkspaceLeaf, TFile } from 'obsidian';
import { WidgetConfig } from './widget-config';

// Add type declaration for WorkspaceSplit
interface WorkspaceSplit {
  children?: any[];
  containerEl?: HTMLElement;
}

export class WidgetManager {
  private app: App;
  public hostedLeaves: Map<string, WorkspaceLeaf> = new Map();
  private ownedLeaves: Set<string> = new Set();

  constructor(app: App) {
    this.app = app;
    console.debug('[Dashboard][WidgetManager] Constructed');
  }

  /**
   * Create a genuine WorkspaceSplit inside the given hostEl,
   * then move or create the target leaf into it.
   *
   * This is the legitimate path — leaf stays in workspace tree.
   */
  async hostLeafInElement(
    config: WidgetConfig,
    hostEl: HTMLElement
  ): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;

    console.debug(`[Dashboard][WidgetManager] hostLeafInElement START — widget="${config.id}" viewType="${config.viewType}"`);
    console.debug(`[Dashboard][WidgetManager] hostEl dimensions: ${hostEl.offsetWidth}x${hostEl.offsetHeight}`);

    if (this.hostedLeaves.has(config.id)) {
      console.debug(`[Dashboard][WidgetManager] Reusing already-hosted leaf for widget "${config.id}"`);
      return this.hostedLeaves.get(config.id)!;
    }

    // Step A1: Get or create the leaf we want to host
    let targetLeaf: WorkspaceLeaf | null = null;
    const existingLeaves = workspace.getLeavesOfType(config.viewType);

    console.debug(`[Dashboard][WidgetManager] getLeavesOfType("${config.viewType}") returned ${existingLeaves.length} leaves`);

    if (existingLeaves.length > 0 && existingLeaves[0] !== undefined) {
      targetLeaf = existingLeaves[0];
      console.debug(`[Dashboard][WidgetManager] Using existing leaf, parent type: ${(targetLeaf as any).parent?.constructor?.name}`);
    } else {
      console.debug(`[Dashboard][WidgetManager] No existing leaf — will create via createLeafInParent`);
    }

    // Step A2: Create a WorkspaceSplit inside hostEl
    // We use the internal API: workspace.createLeafInParent needs a WorkspaceSplit
    // But we need to CREATE that split first inside our hostEl

    // Method: use (workspace as any) to access createLeafBySplit or equivalent
    const wsAny = workspace as any;

    console.debug('[Dashboard][WidgetManager] Checking for createLeafInParent:', typeof wsAny.createLeafInParent);
    console.debug('[Dashboard][WidgetManager] Checking for rootSplit:', wsAny.rootSplit?.constructor?.name);
    console.debug('[Dashboard][WidgetManager] rootSplit.children count:', wsAny.rootSplit?.children?.length);

    // Step A3: The key insight — use workspace.createLeafInParent
    // to place a new leaf in the rootSplit, then move its containerEl subtree
    // into our hostEl, while leaving the leaf in the workspace tree
    try {
      const rootSplit: WorkspaceSplit = wsAny.rootSplit;

      if (!rootSplit) {
        console.error('[Dashboard][WidgetManager] rootSplit is null — cannot proceed');
        return null;
      }

      let newLeaf: WorkspaceLeaf;

      if (targetLeaf) {
        // Use the existing leaf — we will reposition its containerEl subtree
        newLeaf = targetLeaf;
        console.debug('[Dashboard][WidgetManager] Reusing existing leaf:', newLeaf.getViewState());
      } else {
        // Create a new leaf legitimately in the root split
        newLeaf = wsAny.createLeafInParent(rootSplit, rootSplit.children?.length ?? 0);
        console.debug('[Dashboard][WidgetManager] Created new leaf via createLeafInParent');

        // --- Special Handling for Markdown & Bases & Canvas ---
        if ((config.viewType === 'markdown' || config.viewType === 'bases' || config.viewType === 'canvas') && config.filePath) {
            const file = this.app.vault.getAbstractFileByPath(config.filePath);
            if (file instanceof TFile) {
                await newLeaf.openFile(file);
                console.debug(`[Dashboard][WidgetManager] Opened file "${config.filePath}" in new leaf`);
            } else {
                 console.warn(`[Dashboard][WidgetManager] File not found: "${config.filePath}"`);
                 newLeaf.detach();
                 return null;
            }
        } else {
             // Set the view type
             await newLeaf.setViewState({
                 type: config.viewType,
                 state: (config as any).pluginState ?? {}
             });
             console.debug(`[Dashboard][WidgetManager] Set viewState to "${config.viewType}" on new leaf`);
        }

        // For deferred views (Obsidian >= 1.7.2), ensure loaded
        if (typeof (newLeaf as any).loadIfDeferred === 'function') {
          await (newLeaf as any).loadIfDeferred();
          console.debug('[Dashboard][WidgetManager] loadIfDeferred() called on leaf');
        }
        this.ownedLeaves.add(config.id);
      }

      // Step A4: Move the containerEl SUBTREE into our host
      // IMPORTANT: we are moving the PARENT of containerEl (the WorkspaceTabs wrapper)
      // not just the leaf itself, to preserve Obsidian's expected DOM structure

      const leafContainerEl = (newLeaf as any).containerEl as HTMLElement;
      const tabsWrapper = leafContainerEl.parentElement; // This is the WorkspaceTabs DOM node

      console.debug('[Dashboard][WidgetManager] leafContainerEl:', leafContainerEl?.className);
      console.debug('[Dashboard][WidgetManager] tabsWrapper (parent):', tabsWrapper?.className);
      console.debug('[Dashboard][WidgetManager] tabsWrapper.parentElement:', tabsWrapper?.parentElement?.className);

      if (!tabsWrapper) {
        console.error('[Dashboard][WidgetManager] tabsWrapper is null — leaf DOM structure unexpected');
        // Fallback: try moving containerEl directly
        console.debug('[Dashboard][WidgetManager] Fallback: moving containerEl directly');
        hostEl.appendChild(leafContainerEl);
        leafContainerEl.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
      } else {
        // Move the tabs wrapper into our host
        hostEl.appendChild(tabsWrapper);
        tabsWrapper.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
        leafContainerEl.style.cssText = 'width:100%;height:100%;overflow:hidden;position:relative;';
        console.debug(`[Dashboard][WidgetManager] Moved tabsWrapper into hostEl for widget "${config.id}"`);
      }

      // Step A5: Store references for cleanup
      this.hostedLeaves.set(config.id, newLeaf);

      // Force a layout trigger on the view
      workspace.trigger('layout-change');
      console.debug('[Dashboard][WidgetManager] Triggered layout-change event');

      // Log final DOM state
      console.debug('[Dashboard][WidgetManager] Final hostEl children:',
        Array.from(hostEl.children).map(c => `${c.tagName}.${c.className}`).join(', '));
      console.debug('[Dashboard][WidgetManager] Final leafContainerEl dimensions:',
        `${leafContainerEl.offsetWidth}x${leafContainerEl.offsetHeight}`);

      return newLeaf;

    } catch (err: any) {
      console.error(`[Dashboard][WidgetManager] hostLeafInElement FAILED for "${config.id}":`, err);
      console.error('[Dashboard][WidgetManager] Error stack:', err.stack);
      return null;
    }
  }

  /**
   * Strategy B fallback: when Strategy A fails, render the view's content
   * using MarkdownRenderer for note-based views, or a command-triggered
   * iframe-style host for plugin views.
   */
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

  /**
   * Attempt to restore all hosted leaves back to normal workspace positions.
   * Called on view close.
   */
  restoreAll() {
    console.debug(`[Dashboard][WidgetManager] restoreAll — restoring ${this.hostedLeaves.size} leaves`);

    for (const [widgetId, leaf] of this.hostedLeaves.entries()) {
      try {
        if (this.ownedLeaves.has(widgetId)) {
          console.debug(`[Dashboard][WidgetManager] Detaching owned leaf for widget "${widgetId}"`);
          leaf.detach();
        } else {
            // Move the leaf's DOM back into the root split's DOM
            const wsAny = this.app.workspace as any;
            const rootSplit = wsAny.rootSplit;

            if (rootSplit && rootSplit.containerEl) {
            const tabsWrapper = (leaf as any).containerEl.parentElement;
            if (tabsWrapper) {
                rootSplit.containerEl.appendChild(tabsWrapper);
                console.debug(`[Dashboard][WidgetManager] Restored leaf "${widgetId}" to rootSplit DOM`);
            } else {
                console.warn(`[Dashboard][WidgetManager] tabsWrapper missing for "${widgetId}" — detaching leaf`);
                leaf.detach();
            }
            }
        }
      } catch (err) {
        console.error(`[Dashboard][WidgetManager] Error restoring leaf "${widgetId}":`, err);
      }
    }

    // Trigger workspace re-layout
    this.app.workspace.trigger('layout-change');
    console.debug(`[Dashboard][WidgetManager] layout-change triggered after restore`);

    this.hostedLeaves.clear();
    this.ownedLeaves.clear();
    console.debug('[Dashboard][WidgetManager] restoreAll complete');
  }

  async getOrCreateLeaf(config: WidgetConfig): Promise<WorkspaceLeaf | null> {
    // Kept to avoid modifying `src/view.ts` signatures. We will redirect functionality to hostLeafInElement
    return null;
  }

  postMountDiagnostic(
    widgetId: string,
    leaf: WorkspaceLeaf | null,
    hostEl: HTMLElement,
    app: App
  ) {
    console.group(`[DIAG][PostMount] Widget "${widgetId}"`);

    if (!leaf) {
      console.error('[DIAG] leaf is null — mount failed entirely');
      console.groupEnd();
      return;
    }

    // 1. Is the leaf still in the workspace tree?
    let foundInTree = false;
    app.workspace.iterateAllLeaves((l) => {
      if (l === leaf) foundInTree = true;
    });
    console.debug('[DIAG] Leaf found in workspace.iterateAllLeaves:', foundInTree);
    if (!foundInTree) {
      console.warn('[DIAG] ⚠️ Leaf is NOT in the workspace tree — it has been orphaned. Approach needs revision.');
    }

    // 2. Is the leaf's containerEl inside our hostEl?
    const isInsideHost = hostEl.contains((leaf as any).containerEl);
    console.debug('[DIAG] leaf.containerEl is inside hostEl:', isInsideHost);
    if (!isInsideHost) {
      console.warn('[DIAG] ⚠️ leaf.containerEl is NOT inside hostEl — DOM move did not happen or was reverted');
      console.debug('[DIAG] leaf.containerEl.parentElement chain:');
      let el: HTMLElement | null = (leaf as any).containerEl;
      let depth = 0;
      while (el && depth < 8) {
        console.debug(`  ${'  '.repeat(depth)}<${el.tagName}.${el.className}>`);
        el = el.parentElement;
        depth++;
      }
    }

    // 3. Does the leaf have a view?
    console.debug('[DIAG] leaf.view:', leaf.view?.constructor?.name || 'null/DeferredView');
    if (!leaf.view || leaf.view.constructor.name === 'DeferredView') {
      console.warn('[DIAG] ⚠️ View is still deferred — call leaf.loadIfDeferred() and await it');
    }

    // 4. What are the rendered dimensions?
    const leafRect = (leaf as any).containerEl.getBoundingClientRect();
    const hostRect = hostEl.getBoundingClientRect();
    console.debug('[DIAG] hostEl rect:', JSON.stringify({ w: Math.round(hostRect.width), h: Math.round(hostRect.height) }));
    console.debug('[DIAG] leaf.containerEl rect:', JSON.stringify({ w: Math.round(leafRect.width), h: Math.round(leafRect.height) }));
    if (leafRect.width === 0 || leafRect.height === 0) {
      console.warn('[DIAG] ⚠️ Leaf has zero dimensions — it may not be receiving layout. Check CSS on hostEl and parent chain.');
      // Log the CSS chain
      let el: HTMLElement | null = (leaf as any).containerEl;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
          console.warn(`[DIAG] Hidden ancestor found: <${el.tagName}.${el.className}> display=${style.display} visibility=${style.visibility}`);
        }
        el = el.parentElement;
      }
    }

    // 5. Is the view interactive? (check for pointer-events)
    const pEvents = window.getComputedStyle((leaf as any).containerEl).pointerEvents;
    console.debug('[DIAG] leaf.containerEl pointer-events:', pEvents);
    if (pEvents === 'none') {
      console.warn('[DIAG] ⚠️ pointer-events:none on containerEl — widget will not be interactive');
    }

    // 6. Parent chain in workspace tree
    console.group('[DIAG] Leaf workspace parent chain:');
    let wsItem: any = leaf;
    let d = 0;
    while (wsItem && d < 6) {
      console.debug(`${'  '.repeat(d)}[${wsItem.constructor?.name}] id=${wsItem.id || '—'}`);
      wsItem = wsItem.parent;
      d++;
    }
    console.groupEnd();

    console.groupEnd(); // end post-mount group
  }
}
