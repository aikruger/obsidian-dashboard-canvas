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
  public mountedLeaves: Map<string, WorkspaceLeaf> = new Map();
  private originalParents: Map<string, { parent: HTMLElement | null; nextSibling: ChildNode | null }> = new Map();
  public observers: Map<string, MutationObserver> = new Map();

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
    console.debug(`[Dashboard][WidgetManager] restoreAll — restoring ${this.mountedLeaves.size} leaves`);

    for (const widgetId of Array.from(this.mountedLeaves.keys())) {
      this.restoreLeaf(widgetId);
    }

    this.ownedLeaves.clear();
    console.debug('[Dashboard][WidgetManager] restoreAll complete');
  }

  async getOrCreateLeaf(config: WidgetConfig): Promise<WorkspaceLeaf | null> {
    console.debug(`[Dashboard][WidgetManager] getOrCreateLeaf — widget="${config.id}", viewType="${config.viewType}"`);

    if (this.mountedLeaves.has(config.id)) {
      console.debug(`[Dashboard][WidgetManager] Reusing already-mounted leaf for widget "${config.id}"`);
      return this.mountedLeaves.get(config.id)!;
    }

    const { workspace } = this.app;

    // --- CANVAS ---
    if (config.viewType === 'canvas' && config.filePath) {
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
    if (config.viewType === 'bases' && config.filePath) {
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
    if (config.viewType) {
      // Find existing
      const existingLeaves = workspace.getLeavesOfType(config.viewType);
      if (existingLeaves.length > 0 && existingLeaves[0] !== undefined) {
        console.debug(`[Dashboard][WidgetManager] Found ${existingLeaves.length} existing leaf(ves) for viewType "${config.viewType}", using first`);
        return existingLeaves[0];
      }

      const leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        console.warn(`[Dashboard][WidgetManager] Could not get right sidebar leaf for plugin view "${config.viewType}"`);
        return null;
      }
      try {
        await leaf.setViewState({
          type: config.viewType,
          state: (config as any).pluginState ?? {}
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

    console.warn(`[Dashboard][WidgetManager] No handler matched for widget "${config.id}"`);
    return null;
  }

  async mountLeaf(
    leaf: WorkspaceLeaf,
    hostEl: HTMLElement,
    widgetId: string
  ): Promise<boolean> {
    const { workspace } = this.app;

    console.debug(`[Dashboard][Mount] START widget="${widgetId}" viewType="${leaf.getViewState().type}"`);

    // Step 1: Make Obsidian treat this leaf as revealed (removes display:none)
    // revealLeaf navigates to the leaf's tab group and makes it the active tab
    workspace.revealLeaf(leaf);
    console.debug(`[Dashboard][Mount] revealLeaf called for "${widgetId}"`);

    // Small wait for Obsidian to finish the reveal animation/layout cycle
    await new Promise(resolve => window.setTimeout(resolve, 80));

    // Step 2: Load deferred view if needed (Obsidian >= 1.7.2)
    if (typeof (leaf as any).loadIfDeferred === 'function') {
      await (leaf as any).loadIfDeferred();
      console.debug(`[Dashboard][Mount] loadIfDeferred complete for "${widgetId}"`);
    }

    const containerEl = (leaf as any).containerEl as HTMLElement;
    console.debug(`[Dashboard][Mount] containerEl class="${containerEl.className}"`);
    console.debug(`[Dashboard][Mount] containerEl current parent class="${containerEl.parentElement?.className}"`);
    console.debug(`[Dashboard][Mount] containerEl computed display="${window.getComputedStyle(containerEl).display}"`);
    console.debug(`[Dashboard][Mount] containerEl rect before move:`, containerEl.getBoundingClientRect());

    // Step 3: Record original location for restore
    this.originalParents.set(widgetId, {
      parent: containerEl.parentElement,
      nextSibling: containerEl.nextSibling,
    });

    // Step 4: Move containerEl into host
    hostEl.appendChild(containerEl);
    console.debug(`[Dashboard][Mount] containerEl moved into hostEl for "${widgetId}"`);

    // Step 5: Override any residual display:none / visibility:hidden Obsidian set
    containerEl.style.removeProperty('display');
    containerEl.style.removeProperty('visibility');
    containerEl.style.cssText = [
      containerEl.style.cssText,
      'width:100% !important',
      'height:100% !important',
      'max-width:none !important',
      'max-height:none !important',
      'position:relative !important',
      'display:flex !important',
      'flex-direction:column !important',
    ].join(';');
    console.debug(`[Dashboard][Mount] Forced styles applied to containerEl`);

    // Step 6: Guard against Obsidian re-hiding the leaf
    // When layout-change fires, Obsidian may set display:none on inactive tabs
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          const el = m.target as HTMLElement;
          const display = el.style.display;
          const visibility = el.style.visibility;
          if (display === 'none' || visibility === 'hidden') {
            console.warn(`[Dashboard][Mount] ⚠️ Obsidian tried to hide "${widgetId}" — overriding`);
            el.style.removeProperty('display');
            el.style.removeProperty('visibility');
            el.style.display = 'flex';
          }
        }
      }
    });
    observer.observe(containerEl, { attributes: true, attributeFilter: ['style', 'class'] });
    this.observers.set(widgetId, observer);
    console.debug(`[Dashboard][Mount] MutationObserver guard active for "${widgetId}"`);

    // Step 7: Trigger a resize event so the plugin's view re-measures itself
    window.dispatchEvent(new Event('resize'));
    console.debug(`[Dashboard][Mount] resize event dispatched`);

    // Step 8: Verify the mount worked
    await new Promise(resolve => window.setTimeout(resolve, 50));
    const finalRect = containerEl.getBoundingClientRect();
    console.debug(`[Dashboard][Mount] FINAL containerEl rect:`, finalRect);
    if (finalRect.width === 0 || finalRect.height === 0) {
      console.error(`[Dashboard][Mount] ❌ FAILED — containerEl still 0×0 after mount for "${widgetId}"`);
      console.debug(`[Dashboard][Mount] hostEl rect:`, hostEl.getBoundingClientRect());
      console.debug(`[Dashboard][Mount] hostEl computed display:`, window.getComputedStyle(hostEl).display);
      console.debug(`[Dashboard][Mount] hostEl computed height:`, window.getComputedStyle(hostEl).height);
      // Walk parent chain looking for what is causing 0 height
      let el: HTMLElement | null = hostEl;
      let depth = 0;
      while (el && depth < 8) {
        const cs = window.getComputedStyle(el);
        console.debug(`[Dashboard][Mount] ancestor[${depth}] <${el.tagName}.${el.className}> display=${cs.display} height=${cs.height} overflow=${cs.overflow}`);
        el = el.parentElement;
        depth++;
      }
      return false;
    }

    console.debug(`[Dashboard][Mount] ✅ SUCCESS — "${widgetId}" mounted at ${Math.round(finalRect.width)}x${Math.round(finalRect.height)}`);
    this.mountedLeaves.set(widgetId, leaf);
    return true;
  }

  restoreLeaf(widgetId: string): void {
    console.debug(`[Dashboard][Restore] Restoring widget "${widgetId}"`);

    // Stop the mutation guard first
    const observer = this.observers.get(widgetId);
    if (observer) {
      observer.disconnect();
      this.observers.delete(widgetId);
      console.debug(`[Dashboard][Restore] MutationObserver disconnected for "${widgetId}"`);
    }

    const leaf = this.mountedLeaves.get(widgetId);
    const originalLocation = this.originalParents.get(widgetId);

    if (!leaf) {
      console.warn(`[Dashboard][Restore] No mounted leaf found for "${widgetId}"`);
      return;
    }

    const containerEl = (leaf as any).containerEl as HTMLElement;

    // Remove our forced styles so Obsidian can manage the leaf normally again
    containerEl.style.cssText = '';
    console.debug(`[Dashboard][Restore] Cleared forced styles from containerEl`);

    if (originalLocation?.parent) {
      originalLocation.parent.insertBefore(containerEl, originalLocation.nextSibling);
      console.debug(`[Dashboard][Restore] containerEl returned to original parent "${originalLocation.parent.className}"`);
    } else {
      // Fallback: put it back in the right sidebar
      const fallbackLeaf = this.app.workspace.getRightLeaf(false);
      if (fallbackLeaf) {
        (fallbackLeaf as any).containerEl.parentElement?.appendChild(containerEl);
        console.debug(`[Dashboard][Restore] containerEl moved to right sidebar fallback`);
      } else {
        leaf.detach();
        console.debug(`[Dashboard][Restore] Leaf detached as last resort`);
      }
    }

    this.mountedLeaves.delete(widgetId);
    this.originalParents.delete(widgetId);
    this.app.workspace.trigger('layout-change');
    console.debug(`[Dashboard][Restore] layout-change triggered after restore of "${widgetId}"`);
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
