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
    if (this.plugin.settings.widgets.length === 0) {
      await this.plugin.loadSettings();
      console.debug('[Dashboard][View] Cold start — loaded settings from disk');
    } else {
      console.debug('[Dashboard][View] Settings already in memory — skipping disk reload');
    }

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

    const refreshBtn = titleBar.createEl('button', { text: '↺', cls: 'dashboard-widget-refresh' });
    refreshBtn.title = 'Refresh widget';
    refreshBtn.addEventListener('click', () => {
      console.log(`[Dashboard][View] Refresh button clicked for widget "${config.id}"`);
      this.refreshWidget(config.id);
    });

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
      // Auto-refresh after mount to let FullCalendar recalculate its time grid
      window.setTimeout(() => {
        console.log(`[Dashboard][View] Auto-refresh after mount for "${config.id}"`);
        this.refreshWidget(config.id);
      }, 800);
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


  // ─── WIDGET REFRESH ──────────────────────────────────────────────────────

  /**
   * Refresh a single mounted widget.
   * Fires onResize() on the leaf's view, dispatches a DOM resize event,
   * and emits a workspace layout-change — these three signals cover the
   * majority of plugin refresh paths (FullCalendar, Dataview, Tasks, etc.).
   */
  refreshWidget(widgetId: string): void {
    console.log(`[Dashboard][View] refreshWidget called for "${widgetId}"`);

    const record = this.widgetManager.getMounts().get(widgetId);
    if (!record) {
      console.warn(`[Dashboard][View] refreshWidget: no mount record for "${widgetId}"`);
      return;
    }

    const leaf = record.leaf;
    const view = leaf.view as any;

    // 1. Call onResize() if the view implements it (FullCalendar, etc.)
    if (typeof view?.onResize === 'function') {
      try {
        view.onResize();
        console.log(`[Dashboard][View] refreshWidget: onResize() called on "${widgetId}"`);
      } catch (err) {
        console.error(`[Dashboard][View] refreshWidget: onResize() threw for "${widgetId}":`, err);
      }
    }

    // 2. If it's a FullCalendar view, call calendar.updateSize() directly
    //    FullCalendar stores its instance on view.calendar or view.fullCalendar
    const calInstance =
      view?.calendar ??
      view?.fullCalendar ??
      view?._calendar ??
      view?.fullCalendarStore?.calendar ??
      (view?.containerEl ?? (leaf as any).containerEl)?.querySelector('.fc')?._calendar ??
      null;

    if (calInstance) {
      console.log(`[Dashboard][View] refreshWidget: FullCalendar instance found on "${widgetId}" via probe`);
    } else {
      console.warn(`[Dashboard][View] refreshWidget: FullCalendar instance NOT found for "${widgetId}" — updateSize skipped`);
    }

    if (calInstance && typeof calInstance.updateSize === 'function') {
      try {
        calInstance.updateSize();
        console.log(`[Dashboard][View] refreshWidget: FullCalendar.updateSize() called on "${widgetId}"`);
      } catch (err) {
        console.warn(`[Dashboard][View] refreshWidget: FullCalendar.updateSize() threw for "${widgetId}":`, err);
      }
    }
    // Also try refetchEvents in case data is stale
    if (calInstance && typeof calInstance.refetchEvents === 'function') {
      try {
        calInstance.refetchEvents();
        console.log(`[Dashboard][View] refreshWidget: FullCalendar.refetchEvents() called on "${widgetId}"`);
      } catch (err) {
        console.warn(`[Dashboard][View] refreshWidget: FullCalendar.refetchEvents() threw for "${widgetId}":`, err);
      }
    }

    // 3. Dispatch a native DOM resize event on the containerEl
    //    — catches plugins that observe ResizeObserver or window 'resize'
    try {
      (leaf as any).containerEl.dispatchEvent(new Event('resize', { bubbles: true }));
      console.log(`[Dashboard][View] refreshWidget: DOM resize event dispatched on "${widgetId}"`);
    } catch (err) {
      console.warn(`[Dashboard][View] refreshWidget: dispatchEvent threw for "${widgetId}":`, err);
    }

    // 4. Trigger workspace layout-change event
    //    — catches plugins that watch (app.workspace as any).trigger('layout-change')
    try {
      (this.app.workspace as any).trigger('layout-change');
      console.log(`[Dashboard][View] refreshWidget: workspace layout-change triggered for "${widgetId}"`);
    } catch (err) {
      console.warn(`[Dashboard][View] refreshWidget: workspace trigger threw for "${widgetId}":`, err);
    }

    window.setTimeout(() => {
      // Second pass — FullCalendar sometimes needs two updateSize() calls
      const rec2 = this.widgetManager.getMounts().get(widgetId);
      if (!rec2) return;
      const view2 = rec2.leaf.view as any;
      const cal2 =
        view2?.calendar ??
        view2?.fullCalendar ??
        view2?._calendar ??
        view2?.fullCalendarStore?.calendar ??
        (view2?.containerEl ?? (rec2.leaf as any).containerEl)?.querySelector('.fc')?._calendar ??
        null;

      if (cal2 && typeof cal2.updateSize === 'function') {
        try {
          cal2.updateSize();
          console.log(`[Dashboard][View] refreshWidget: second-pass FullCalendar.updateSize() for "${widgetId}"`);
        } catch(e) {
          console.warn(`[Dashboard][View] Second-pass updateSize threw:`, e);
        }
      }
    }, 500);
  }

  /**
   * Refresh ALL mounted widgets — callable from the toolbar
   * and automatically on a 30-second interval if enabled.
   */
  refreshAllWidgets(): void {
    console.log(`[Dashboard][View] refreshAllWidgets called — refreshing ${this.widgetManager.getMounts().size} widget(s)`);
    for (const widgetId of this.widgetManager.getMounts().keys()) {
      this.refreshWidget(widgetId);
    }
  }

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

    const sep = toolbarEl.createEl('span', { cls: 'dashboard-toolbar-sep' });

    // Layout selector dropdown
    const layoutSelect = toolbarEl.createEl('select', { cls: 'dashboard-toolbar-select' });
    this.rebuildLayoutSelect(layoutSelect);
    layoutSelect.addEventListener('change', async () => {
      const selectedId = layoutSelect.value;
      if (!selectedId) return;
      console.log(`[Dashboard][View] Switching to layout "${selectedId}"`);
      await this.loadLayout(selectedId);
    });

    // Save to current layout button
    const saveBtn = toolbarEl.createEl('button', { text: '💾 Save', cls: 'dashboard-toolbar-btn' });
    saveBtn.title = 'Save current widget arrangement to active layout';
    saveBtn.addEventListener('click', async () => {
      await this.saveCurrentLayout();
    });

    // Save as new named layout
    const saveAsBtn = toolbarEl.createEl('button', { text: '💾 Save as…', cls: 'dashboard-toolbar-btn' });
    saveAsBtn.title = 'Save as a new named layout';
    saveAsBtn.addEventListener('click', () => {
      this.promptSaveAsLayout(layoutSelect);
    });

    // Delete layout button
    const deleteLayoutBtn = toolbarEl.createEl('button', { text: '🗑', cls: 'dashboard-toolbar-btn' });
    deleteLayoutBtn.title = 'Delete active layout';
    deleteLayoutBtn.addEventListener('click', async () => {
      await this.deleteActiveLayout(layoutSelect);
    });

    const refreshAllBtn = toolbarEl.createEl('button', { text: '↺ Refresh all', cls: 'dashboard-toolbar-btn' });
    refreshAllBtn.title = 'Force all widgets to re-render with latest data';
    refreshAllBtn.addEventListener('click', () => {
      console.log('[Dashboard][View] Refresh all widgets triggered from toolbar');
      this.refreshAllWidgets();
    });
  }

  rebuildLayoutSelect(selectEl: HTMLSelectElement): void {
    selectEl.empty();
    const placeholder = selectEl.createEl('option', { text: '— Select layout —', value: '' });
    placeholder.disabled = true;
    for (const layout of this.plugin.settings.layouts) {
      const opt = selectEl.createEl('option', { text: layout.name, value: layout.id });
      if (layout.id === this.plugin.settings.activeLayoutId) {
        opt.selected = true;
      }
    }
    console.debug('[Dashboard][View] Layout select rebuilt with', this.plugin.settings.layouts.length, 'layouts');
  }

  async saveCurrentLayout(): Promise<void> {
    const activeId = this.plugin.settings.activeLayoutId;
    if (!activeId) {
      // No active layout — prompt to name it
      new Notice('No active layout — use "Save as…" to create one');
      return;
    }
    const layout = this.plugin.settings.layouts.find((l: any) => l.id === activeId);
    if (!layout) return;
    layout.widgets = [...this.plugin.settings.widgets];
    layout.zoom = this.zoom;
    layout.panX = this.panX;
    layout.panY = this.panY;
    await this.plugin.saveSettings();
    new Notice(`Layout "${layout.name}" saved ✓`);
    console.log(`[Dashboard][View] Layout "${layout.name}" saved`);
  }

  promptSaveAsLayout(selectEl: HTMLSelectElement): void {
    // Use Obsidian's Modal for a simple text prompt
    const { Modal, Setting } = require('obsidian');
    class NameModal extends Modal {
      name = '';
      onSubmit: (name: string) => void;
      constructor(app: any, onSubmit: (name: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
      }
      onOpen() {
        this.titleEl.setText('Save layout as…');
        new Setting(this.contentEl)
          .setName('Layout name')
          .addText((t: any) => {
            t.setPlaceholder('e.g. "Daily planning"');
            t.onChange((v: string) => { this.name = v; });
            // Submit on Enter
            t.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') { this.close(); this.onSubmit(this.name); }
            });
          });
        new Setting(this.contentEl)
          .addButton((b: any) => b.setButtonText('Save').setCta().onClick(() => {
            this.close();
            this.onSubmit(this.name);
          }));
      }
      onClose() { this.contentEl.empty(); }
    }

    new NameModal(this.app, async (name: string) => {
      if (!name.trim()) return;
      const newLayout = {
        id: `layout-${Date.now()}`,
        name: name.trim(),
        widgets: [...this.plugin.settings.widgets],
        zoom: this.zoom,
        panX: this.panX,
        panY: this.panY,
        createdAt: Date.now(),
      };
      this.plugin.settings.layouts.push(newLayout);
      this.plugin.settings.activeLayoutId = newLayout.id;
      await this.plugin.saveSettings();
      this.rebuildLayoutSelect(selectEl);
      new Notice(`Layout "${newLayout.name}" created ✓`);
      console.log(`[Dashboard][View] New layout created: "${newLayout.name}" (${newLayout.id})`);
    }).open();
  }

  async loadLayout(layoutId: string): Promise<void> {
    const layout = this.plugin.settings.layouts.find((l: any) => l.id === layoutId);
    if (!layout) {
      console.warn(`[Dashboard][View] loadLayout: layout "${layoutId}" not found`);
      return;
    }
    console.log(`[Dashboard][View] Loading layout "${layout.name}"`);

    // Restore all current widget leaves before clearing
    this.widgetManager.restoreAll();

    // Clear canvas
    this.canvasEl.empty();

    // Apply layout
    this.plugin.settings.activeLayoutId = layoutId;
    this.plugin.settings.widgets = [...layout.widgets];
    this.zoom = layout.zoom ?? 1;
    this.panX = layout.panX ?? 0;
    this.panY = layout.panY ?? 0;
    this.applyTransform();
    await this.plugin.saveSettings();

    for (const config of this.plugin.settings.widgets) {
      await this.renderWidget(config);
    }
    new Notice(`Layout "${layout.name}" loaded ✓`);
    console.log(`[Dashboard][View] Layout "${layout.name}" loaded — ${layout.widgets.length} widgets`);
  }

  async deleteActiveLayout(selectEl: HTMLSelectElement): Promise<void> {
    const activeId = this.plugin.settings.activeLayoutId;
    if (!activeId) { new Notice('No active layout to delete'); return; }
    const layout = this.plugin.settings.layouts.find((l: any) => l.id === activeId);
    if (!layout) return;
    this.plugin.settings.layouts = this.plugin.settings.layouts.filter((l: any) => l.id !== activeId);
    this.plugin.settings.activeLayoutId = null;
    await this.plugin.saveSettings();
    this.rebuildLayoutSelect(selectEl);
    new Notice(`Layout "${layout.name}" deleted`);
    console.log(`[Dashboard][View] Layout "${layout.name}" deleted`);
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