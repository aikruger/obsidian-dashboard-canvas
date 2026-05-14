import { ItemView, WorkspaceLeaf, Menu, TFile, ViewStateResult, Notice } from 'obsidian';
import DashboardPlugin from './main';
import { WidgetConfig } from './widget-config';
import { WidgetManager } from './widget-manager';
import { LayoutManager } from './layout-manager';
import { WidgetDiscovery } from './widget-discovery';

export const VIEW_TYPE_DASHBOARD = 'dashboard-canvas-view';

export class DashboardView extends ItemView {
  plugin: DashboardPlugin;
  widgetManager: WidgetManager;
  layoutManager: LayoutManager;
  canvasEl: HTMLElement;
  viewportEl: HTMLElement;
  zoom = 1;
  panX = 0;
  panY = 0;
  private altScrollHandler: ((ev: WheelEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.widgetManager = new WidgetManager(this.app);
    console.debug('[Dashboard][View] DashboardView constructed');
  }

  getViewType() { return VIEW_TYPE_DASHBOARD; }
  getDisplayText() { return 'Dashboard canvas'; }
  getIcon() { return 'layout-dashboard'; }

  async onOpen() {
    console.debug('[Dashboard][View] onOpen — reloading settings from disk');
    // Always re-read from data.json so we have the latest saved widgets
    await this.plugin.loadSettings();
    console.debug('[Dashboard][View] onOpen — widget count from disk:', this.plugin.settings.widgets.length);

    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.classList.add('dashboard-container');

    // Toolbar above canvas
    const toolbar = container.createDiv({ cls: 'dashboard-toolbar' });
    this.buildToolbar(toolbar);

    // Viewport (handles pan/zoom transforms)
    this.viewportEl = container.createDiv({ cls: 'dashboard-viewport' });

    // Canvas (widgets positioned absolutely inside this)
    this.canvasEl = this.viewportEl.createDiv({ cls: 'dashboard-canvas' });

    // Restore zoom / pan from settings
    this.zoom = this.plugin.settings.zoom ?? 1;
    this.panX = this.plugin.settings.panX ?? 0;
    this.panY = this.plugin.settings.panY ?? 0;
    this.applyTransform();

    // Apply saved canvas background
    this.applyCanvasBackground(this.plugin.settings.canvasBackground);
    console.debug('[Dashboard][View] Canvas background applied:', this.plugin.settings.canvasBackground);

    // Layout manager — pass a getZoom accessor so it can divide interact.js deltas
    this.layoutManager = new LayoutManager(
      this.canvasEl,
      this.plugin.settings.widgets,
      async (widgets) => {
        this.plugin.settings.widgets = [...widgets];
        await this.plugin.saveSettings();
        console.debug('[Dashboard][View] Layout change persisted — widget count:', widgets.length);
      },
      () => this.zoom
    );

    // Pan + zoom event handlers
    this.setupPanAndZoom();

    // Render all saved widgets
    for (const config of this.plugin.settings.widgets) {
      await this.renderWidget(config);
    }

    console.debug('[Dashboard][View] onOpen complete —', this.plugin.settings.widgets.length, 'widgets rendered');
  }

  setupLayoutChangeGuard() {
    console.debug('[Dashboard][View] Setting up layout-change guard');

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        console.debug('[Dashboard][View] layout-change fired — checking widget DOM integrity');

        let reboundCount = 0;
        for (const [widgetId, record] of this.widgetManager.getMounts().entries()) {
          const hostEl = this.canvasEl.querySelector(`[data-widget-id="${widgetId}"] .dashboard-widget-content`) as HTMLElement;
          if (!hostEl) {
            console.warn(`[Dashboard][View] No hostEl found for widget "${widgetId}" during layout-change guard`);
            continue;
          }

          const isStillInHost = hostEl.contains((record.leaf as any).containerEl);
          console.debug(`[Dashboard][View] layout-change guard: widget "${widgetId}" still in host: ${isStillInHost}`);

          if (!isStillInHost) {
            console.warn(`[Dashboard][View] ⚠️ Workspace reclaimed leaf for "${widgetId}" — re-mounting`);
            // Attempt re-mount
            const containerEl = (record.leaf as any).containerEl;
            if (containerEl) {
              hostEl.appendChild(containerEl);
              reboundCount++;
              console.debug(`[Dashboard][View] Re-mounted leaf for "${widgetId}"`);
            }
          }
        }

        if (reboundCount > 0) {
          console.debug(`[Dashboard][View] Re-bound ${reboundCount} widgets after layout-change`);
        }
      })
    );
  }

  // ─── WIDGET RENDERING ────────────────────────────────────────────────────

  async renderWidget(config: WidgetConfig) {
    console.debug(`[Dashboard][View] renderWidget "${config.id}", viewType="${config.viewType}"`);

    const slot = this.canvasEl.createDiv({ cls: 'dashboard-widget-slot' });
    slot.dataset.widgetId = config.id;
    this.layoutManager.applyToSlot(slot, config);

    // Title bar
    const titleBar = slot.createDiv({ cls: 'dashboard-widget-titlebar' });
    const handle = titleBar.createDiv({ cls: 'dashboard-widget-handle' });
    handle.createEl('span', { text: '⠿', cls: 'dashboard-widget-drag-icon' });
    titleBar.createEl('span', { text: config.label, cls: 'dashboard-widget-label' });
    const closeBtn = titleBar.createEl('button', { text: '✕', cls: 'dashboard-widget-close' });
    closeBtn.addEventListener('click', () => { this.removeWidget(config.id).catch(console.error); });

    // Content frame
    const contentFrame = slot.createDiv({ cls: 'dashboard-widget-content' });

    // Acquire leaf and mount
    const leaf = await this.widgetManager.getOrCreateLeaf(config);
    if (!leaf) {
      const reason = !config.filePath
        ? 'No file configured'
        : 'Plugin not loaded or file not found';
      contentFrame.createEl('p', {
        text: `Widget error: ${reason} (${config.viewType}${config.filePath ? ' — ' + config.filePath : ''})`,
        cls: 'dashboard-widget-error',
      });
      console.warn(`[Dashboard][View] Could not acquire leaf for widget "${config.id}": ${reason}`);
      return;
    }

    const mountSuccess = await this.widgetManager.mountLeaf(leaf as any, contentFrame, config.id, config.label);
    if (mountSuccess) {
      console.debug(`[Dashboard][View] Widget "${config.id}" leaf mounted successfully`);
    } else {
      const reason = !config.filePath
        ? 'No file configured'
        : 'Plugin not loaded or file not found';
      contentFrame.createEl('p', {
        text: `Widget error: ${reason} (${config.viewType}${config.filePath ? ' — ' + config.filePath : ''})`,
        cls: 'dashboard-widget-error',
      });
      console.warn(`[Dashboard][View] Could not acquire leaf for widget "${config.id}": ${reason}`);
    }

    this.layoutManager.attachInteract(slot, config);
    console.debug(`[Dashboard][View] renderWidget "${config.id}" complete`);
  }

  // ─── ADD / REMOVE WIDGETS ────────────────────────────────────────────────


  async removeWidget(widgetId: string) {
    console.debug(`[Dashboard][View] removeWidget "${widgetId}"`);

    this.widgetManager.restoreLeaf(widgetId);

    this.canvasEl.querySelector(`[data-widget-id="${widgetId}"]`)?.remove();
    this.plugin.settings.widgets = this.plugin.settings.widgets.filter(w => w.id !== widgetId);
    await this.plugin.saveSettings();
    console.debug(`[Dashboard][View] Widget "${widgetId}" removed and settings saved`);
  }

  // ─── ADD ACTIVE VIEW TO DASHBOARD ────────────────────────────────────────

  addActiveViewToDashboard() {
    // getActiveLeaf is internal but available
    const activeLeaf = (this.app.workspace as unknown as { getActiveLeaf: () => WorkspaceLeaf | undefined }).getActiveLeaf();
    if (!activeLeaf || activeLeaf === this.leaf) {
      console.warn('[Dashboard][View] addActiveViewToDashboard: no eligible active leaf');
      return;
    }
    const vs = activeLeaf.getViewState();
    const type = vs.type ?? '';
    const filePath = (vs.state as Record<string, unknown>)?.file as string | undefined;

    console.debug('[Dashboard][View] addActiveViewToDashboard — viewType:', type, 'filePath:', filePath);

    if (type === 'markdown' && filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this.addWidgetForViewType('markdown', file.basename, null, file.path).catch(console.error);
        return;
      }
    }
    if (type === 'canvas' && filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this.addWidgetForViewType('canvas', file.basename, null, file.path).catch(console.error);
        return;
      }
    }
    if (type === 'bases' && filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this.addWidgetForViewType('bases', file.basename, null, file.path).catch(console.error);
        return;
      }
    }
    // Generic plugin view
    const displayText = activeLeaf.view?.getDisplayText?.() ?? type;
    this.addWidgetForViewType(type, displayText, null).catch(console.error);
  }

  // ─── TOOLBAR ─────────────────────────────────────────────────────────────

  buildToolbar(toolbarEl: HTMLElement) {
    const addBtn = toolbarEl.createEl('button', { text: '+ Add widget', cls: 'dashboard-toolbar-btn' });
    addBtn.addEventListener('click', (evt) => { this.openAddWidgetMenu(evt); });

    const activeBtn = toolbarEl.createEl('button', { text: '⊕ Add active view', cls: 'dashboard-toolbar-btn' });
    activeBtn.title = 'Add whatever is currently open to the dashboard';
    activeBtn.addEventListener('click', () => this.addActiveViewToDashboard());

    const zoomInBtn = toolbarEl.createEl('button', { text: '+', cls: 'dashboard-toolbar-btn dashboard-zoom-btn' });
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.addEventListener('click', () => this.changeZoom(0.1));

    const zoomOutBtn = toolbarEl.createEl('button', { text: '−', cls: 'dashboard-toolbar-btn dashboard-zoom-btn' });
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.addEventListener('click', () => this.changeZoom(-0.1));

    const zoomResetBtn = toolbarEl.createEl('button', { text: '100%', cls: 'dashboard-toolbar-btn dashboard-zoom-btn' });
    zoomResetBtn.title = 'Reset zoom';
    zoomResetBtn.addEventListener('click', () => this.setZoom(1));

    const saveBtn = toolbarEl.createEl('button', { text: '💾 Save layout', cls: 'dashboard-toolbar-btn' });
    saveBtn.addEventListener('click', () => {
      this.plugin.saveSettings().catch(console.error);
      console.debug('[Dashboard][View] Layout manually saved');
    });
  }

  openAddWidgetMenu(evt: MouseEvent) {
    console.debug('[Dashboard][View] openAddWidgetMenu triggered');

    const discovery = new WidgetDiscovery(this.app);
    const allViews = discovery.discoverAllViews();

    console.debug(`[Dashboard][View] Menu will show ${allViews.length} view types`);

    const menu = new Menu();

    // Group 1: Currently open views (can be hosted immediately)
    const openViews = allViews.filter(v => v.isOpen);
    const closedViews = allViews.filter(v => !v.isOpen);

    if (openViews.length > 0) {
      menu.addItem(item => item.setTitle('── Currently Open Views ──').setDisabled(true));
      for (const view of openViews) {
        const locationIcon = view.location === 'left' ? '◀' :
                             view.location === 'right' ? '▶' :
                             view.location === 'root' ? '◼' : '?';
        menu.addItem(item =>
          item
            .setTitle(`${locationIcon} ${view.label}`)
            .setIcon('layout-panel-left')
            .onClick(async () => {
              console.debug(`[Dashboard][View] User selected open view: "${view.viewType}"`);
              await this.addWidgetForViewType(view.viewType, view.label, view.sampleLeaf);
            })
        );
      }
    }

    // Group 2: Registered but not currently open
    if (closedViews.length > 0) {
      menu.addSeparator();
      menu.addItem(item => item.setTitle('── Registered But Closed ──').setDisabled(true));
      for (const view of closedViews) {
        menu.addItem(item =>
          item
            .setTitle(`○ ${view.label}`)
            .setIcon('circle')
            .onClick(async () => {
              console.debug(`[Dashboard][View] User selected closed view: "${view.viewType}" — will attempt to open`);
              await this.addWidgetForViewType(view.viewType, view.label, null);
            })
        );
      }
    }

    // Group 3: Markdown file (user picks a note)
    menu.addSeparator();
    menu.addItem(item =>
      item
        .setTitle('📄 Markdown Note…')
        .setIcon('file-text')
        .onClick(() => {
          console.debug('[Dashboard][View] User selected Markdown Note option');
          // Open a file suggestion modal
          this.openFilePicker('markdown');
        })
    );

    // Group 4: Canvas file
    menu.addItem(item =>
      item
        .setTitle('🖼 Canvas File…')
        .setIcon('layout-dashboard')
        .onClick(() => {
          console.debug('[Dashboard][View] User selected Canvas File option');
          this.openFilePicker('canvas');
        })
    );

    // Group 5: Bases file
    menu.addItem(item =>
      item
        .setTitle('🗃 Bases File…')
        .setIcon('database')
        .onClick(() => {
          console.debug('[Dashboard][View] User selected Bases File option');
          this.openFilePicker('bases');
        })
    );

    menu.showAtMouseEvent(evt);
    console.debug('[Dashboard][View] Menu shown with', allViews.length, 'view entries');
  }

  /**
   * Add a widget for a given viewType.
   * If the leaf doesn't exist yet, attempt to create one.
   */
  async addWidgetForViewType(
    viewType: string,
    label: string,
    existingLeaf: WorkspaceLeaf | null,
    filePath?: string
  ) {
    console.debug(`[Dashboard][View] addWidgetForViewType: viewType="${viewType}" label="${label}"`);

    // If no leaf exists, try to open the view via its registered command
    if (!existingLeaf) {
      console.debug(`[Dashboard][View] No leaf for "${viewType}" — attempting to create via workspace`);
      try {
        const newLeaf = this.app.workspace.getRightLeaf(false);
        if (newLeaf) {
          await newLeaf.setViewState({ type: viewType });
          existingLeaf = newLeaf;
          console.debug(`[Dashboard][View] Created new leaf for "${viewType}" in right sidebar`);
          // Allow view to initialise
          await new Promise(resolve => window.setTimeout(resolve, 150));
          if (typeof (existingLeaf as any).loadIfDeferred === 'function') {
            await (existingLeaf as any).loadIfDeferred();
          }
        }
      } catch (err) {
        console.error(`[Dashboard][View] Failed to create leaf for "${viewType}":`, err);
      }
    }

    if (!existingLeaf) {
      console.error(`[Dashboard][View] Cannot add widget — no leaf available for "${viewType}"`);
      new Notice(`Could not open view: ${label}. Try opening it manually first.`);
      return;
    }

    const newConfig: WidgetConfig = {
      id: `widget-${viewType}-${Date.now()}`,
      viewType,
      label,
      filePath,
      x: 40 + (this.plugin.settings.widgets.length * 30),  // stagger so they don't all stack
      y: 40 + (this.plugin.settings.widgets.length * 30),
      w: 640,
      h: 480,
    };

    console.debug(`[Dashboard][View] Creating widget config:`, JSON.stringify(newConfig));
    this.plugin.settings.widgets.push(newConfig);
    await this.plugin.saveSettings();
    await this.renderWidget(newConfig);
    console.debug(`[Dashboard][View] Widget "${newConfig.id}" added and rendered`);
  }

  /**
   * Open a file picker for markdown or canvas files.
   * Uses Obsidian's built-in SuggestModal pattern.
   */
  openFilePicker(type: 'markdown' | 'canvas' | 'bases') {
    console.debug(`[Dashboard][View] openFilePicker for type="${type}"`);
    const ext = type === 'canvas' ? 'canvas' : (type === 'bases' ? 'base' : 'md');
    const files = this.app.vault.getFiles().filter(f => f.extension === ext);
    console.debug(`[Dashboard][View] Found ${files.length} .${ext} files in vault`);

    // Use Obsidian's FuzzySuggestModal
    const { FuzzySuggestModal } = require('obsidian');
    class FilePicker extends FuzzySuggestModal<TFile> {
      constructor(app: any, private onChoose: (file: any) => void) {
        super(app);
      }
      getItems() { return files; }
      getItemText(file: any) { return file.path; }
      onChooseItem(file: any) { this.onChoose(file); }
    }

    new FilePicker(this.app, async (file: any) => {
      console.debug(`[Dashboard][View] File picked: "${file.path}" for type="${type}"`);
      const newConfig: WidgetConfig = {
        id: `widget-${type}-${Date.now()}`,
        viewType: type,
        label: file.basename,
        filePath: file.path,
        x: 40,
        y: 40,
        w: 640,
        h: 480,
      };
      this.plugin.settings.widgets.push(newConfig);
      await this.plugin.saveSettings();
      // For file-based views, open the file in a new leaf then mount it
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      await new Promise(resolve => window.setTimeout(resolve, 100));
      await this.renderWidget(newConfig);
      console.debug(`[Dashboard][View] File widget created for "${file.path}"`);
    }).open();
  }

  // ─── ZOOM & PAN ──────────────────────────────────────────────────────────

  /**
   * Apply a background colour to the canvas.
   * Called on open, and live from the settings tab.
   */
  applyCanvasBackground(colour: string): void {
    if (!this.viewportEl) return;
    if (!colour || colour === 'default') {
      this.viewportEl.style.removeProperty('background-color');
      console.debug('[Dashboard][View] Canvas background reset to theme default');
    } else {
      this.viewportEl.style.backgroundColor = colour;
      console.debug('[Dashboard][View] Canvas background set to:', colour);
    }
  }

  applyTransform() {
    if (!this.canvasEl) return;
    this.canvasEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.canvasEl.style.transformOrigin = '0 0';
    console.debug(`[Dashboard][View] applyTransform zoom=${this.zoom.toFixed(2)}, pan=(${Math.round(this.panX)}, ${Math.round(this.panY)})`);
  }

  changeZoom(delta: number) {
    this.setZoom(this.zoom + delta);
  }

  setZoom(value: number) {
    this.zoom = Math.min(2.0, Math.max(0.25, value));
    this.plugin.settings.zoom = this.zoom;
    this.plugin.saveSettings().catch(console.error);
    this.applyTransform();
  }

  setupPanAndZoom() {
    // Ctrl+Wheel zoom — always active
    this.viewportEl.addEventListener('wheel', (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? 0.1 : -0.1;
      this.changeZoom(delta);
    }, { passive: false });

    // Left-click drag to pan (on the bare viewport, not on a widget)
    let isPanning = false;
    let startX = 0, startY = 0, startPanX = 0, startPanY = 0;

    this.viewportEl.addEventListener('mousedown', (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      if ((ev.target as HTMLElement).closest('.dashboard-widget-slot')) return;
      isPanning = true;
      this.viewportEl.classList.add('dashboard-panning');
      startX = ev.clientX;
      startY = ev.clientY;
      startPanX = this.panX;
      startPanY = this.panY;
      console.debug('[Dashboard][View] Pan start');
    });

    window.addEventListener('mousemove', (ev: MouseEvent) => {
      if (!isPanning) return;
      this.panX = startPanX + (ev.clientX - startX);
      this.panY = startPanY + (ev.clientY - startY);
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (!isPanning) return;
      isPanning = false;
      this.viewportEl.classList.remove('dashboard-panning');
      this.plugin.settings.panX = this.panX;
      this.plugin.settings.panY = this.panY;
      this.plugin.saveSettings().catch(console.error);
      console.debug(`[Dashboard][View] Pan end: (${Math.round(this.panX)}, ${Math.round(this.panY)})`);
    });

    // Bind Alt+wheel horizontal scroll based on current setting
    this.bindAltScrollHandler();
  }

  /**
   * Bind or unbind the Alt+wheel horizontal-pan handler.
   * Attaches to the document so it fires regardless of which widget the
   * cursor is currently over — widget iframes/content would otherwise
   * consume the event before it bubbles to the viewport.
   */
  bindAltScrollHandler(): void {
    // Remove any existing handler first to avoid duplicates
    if (this.altScrollHandler) {
      document.removeEventListener('wheel', this.altScrollHandler, true);
      this.altScrollHandler = null;
      console.debug('[Dashboard][View] Alt+scroll handler removed');
    }

    if (!this.plugin.settings.altScrollHorizontal) {
      console.debug('[Dashboard][View] Alt+scroll disabled in settings — not binding');
      return;
    }

    const speed = this.plugin.settings.altScrollSpeed ?? 40;

    this.altScrollHandler = (ev: WheelEvent) => {
      if (!ev.altKey) return;
      // Only intercept while this dashboard view is the active leaf
      if (!this.containerEl.isConnected) return;

      ev.preventDefault();
      ev.stopPropagation();

      // deltaY is the natural scroll axis; we translate it to horizontal pan
      const direction = ev.deltaY > 0 ? -1 : 1;
      this.panX += direction * speed;
      this.applyTransform();

      // Debounce the settings save — use a flag to avoid hammering disk
      if ((this as any)._altScrollSaveTimer) {
        window.clearTimeout((this as any)._altScrollSaveTimer);
      }
      (this as any)._altScrollSaveTimer = window.setTimeout(() => {
        this.plugin.settings.panX = this.panX;
        this.plugin.saveSettings().catch(console.error);
        console.debug(`[Dashboard][View] Alt+scroll panX saved: ${Math.round(this.panX)}`);
      }, 300);
    };

    // Use capture phase so the event fires before widgets' own handlers
    document.addEventListener('wheel', this.altScrollHandler, { passive: false, capture: true });
    console.debug('[Dashboard][View] Alt+scroll handler bound (speed:', speed, 'px/tick)');
  }

  /**
   * Called by the settings tab when altScrollHorizontal is toggled live.
   * Re-binds (or removes) the handler without requiring a view reload.
   */
  public refreshScrollBehaviour(): void {
    console.debug('[Dashboard][View] refreshScrollBehaviour called');
    if (!this.viewportEl) {
      console.warn('[Dashboard][View] refreshScrollBehaviour — viewportEl not ready');
      return;
    }

    // Remove any existing wheel listener first
    if (this.altScrollHandler) {
      document.removeEventListener('wheel', this.altScrollHandler, true);
      this.altScrollHandler = null;
      console.debug('[Dashboard][View] Removed existing wheel handler');
    }

    if (this.plugin.settings.altScrollHorizontal) {
      this.bindAltScrollHandler();
      console.debug('[Dashboard][View] Alt+scroll wheel handler re-attached');
    } else {
      console.debug('[Dashboard][View] Alt+scroll disabled — no wheel handler attached');
    }
  }

  // ─── LIFECYCLE ───────────────────────────────────────────────────────────

  async onClose() {
    console.debug('[Dashboard][View] onClose — restoring all leaves');

    // Remove Alt+scroll handler so it doesn't fire after the view is closed
    if (this.altScrollHandler) {
      document.removeEventListener('wheel', this.altScrollHandler, true);
      this.altScrollHandler = null;
      console.debug('[Dashboard][View] Alt+scroll handler removed on close');
    }

    this.widgetManager.restoreAll();
  }

  getState(): Record<string, unknown> {
    // Only persist ephemeral view state (zoom/pan) in workspace.json
    // Widgets are persisted separately via plugin.settings / data.json
    return {
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    // Only restore zoom/pan from workspace state — never widgets
    if (typeof state.zoom === 'number') this.zoom = state.zoom;
    if (typeof state.panX === 'number') this.panX = state.panX;
    if (typeof state.panY === 'number') this.panY = state.panY;
    console.debug('[Dashboard][View] setState: zoom/pan restored, widgets come from data.json');
    await super.setState(state, result);
  }
}