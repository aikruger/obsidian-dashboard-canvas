import { ItemView, WorkspaceLeaf, Menu, TFile, ViewStateResult } from 'obsidian';
import DashboardPlugin from './main';
import { WidgetConfig, WidgetKind } from './widget-config';
import { WidgetManager } from './widget-manager';
import { LayoutManager } from './layout-manager';
import { MarkdownFileSuggestModal } from './markdown-file-suggest';
import { CanvasFileSuggestModal } from './canvas-file-suggest';
import { PluginViewSelectModal, PluginViewOption } from './plugin-view-select-modal';

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
    console.debug('[Dashboard][View] onOpen — building dashboard');
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

  // ─── WIDGET RENDERING ────────────────────────────────────────────────────

  async renderWidget(config: WidgetConfig) {
    console.debug(`[Dashboard][View] renderWidget "${config.id}", kind="${config.kind}", viewType="${config.viewType}"`);

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
    if (leaf) {
      this.widgetManager.mountLeaf(leaf, contentFrame, config.id);
      console.debug(`[Dashboard][View] Widget "${config.id}" leaf mounted successfully`);
    } else {
      const reason = !config.filePath && config.kind !== 'plugin'
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

  async addWidget(
    kind: WidgetKind,
    viewType: string,
    label: string,
    filePath?: string,
    pluginId?: string,
    pluginState?: unknown
  ) {
    console.debug(`[Dashboard][View] addWidget kind="${kind}", viewType="${viewType}", label="${label}", filePath="${filePath}"`);
    const newConfig: WidgetConfig = {
      id: `widget-${Date.now()}`,
      kind,
      viewType,
      label,
      x: 60 + (this.plugin.settings.widgets.length * 20),
      y: 60 + (this.plugin.settings.widgets.length * 20),
      w: 640,
      h: 420,
      filePath,
      pluginId,
      pluginState,
    };
    this.plugin.settings.widgets.push(newConfig);
    await this.plugin.saveSettings();
    await this.renderWidget(newConfig);
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
        this.addWidget('markdown', 'markdown', file.basename, file.path).catch(console.error);
        return;
      }
    }
    if (type === 'canvas' && filePath) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this.addWidget('canvas', 'canvas', file.basename, file.path).catch(console.error);
        return;
      }
    }
    // Generic plugin view
    const pluginState = vs.state ?? {};
    const displayText = activeLeaf.view?.getDisplayText?.() ?? type;
    this.addWidget('plugin', type, displayText, undefined, undefined, pluginState).catch(console.error);
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
    const menu = new Menu();

    menu.addItem(item =>
      item.setTitle('Canvas file...').setIcon('layout-dashboard').onClick(() => {
        new CanvasFileSuggestModal(this.app, (file) => {
          this.addWidget('canvas', 'canvas', file.basename, file.path).catch(console.error);
        }).open();
      })
    );

    menu.addItem(item =>
      item.setTitle('Markdown note...').setIcon('file-text').onClick(() => {
        new MarkdownFileSuggestModal(this.app, (file) => {
          this.addWidget('markdown', 'markdown', file.basename, file.path).catch(console.error);
        }).open();
      })
    );

    menu.addSeparator();

    menu.addItem(item =>
      item.setTitle('Plugin view...').setIcon('plug').onClick(() => {
        const options = this.getPluginViewOptions();
        if (options.length === 0) {
          console.warn('[Dashboard][View] No plugin views available — open them first');
          return;
        }
        new PluginViewSelectModal(this.app, options, (selected) => {
          this.addWidget('plugin', selected.type, selected.label).catch(console.error);
        }).open();
      })
    );

    menu.showAtMouseEvent(evt);
  }

  getPluginViewOptions(): PluginViewOption[] {
    const seen = new Set<string>();
    const results: PluginViewOption[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const type = leaf.getViewState().type;
      if (!seen.has(type) && type !== VIEW_TYPE_DASHBOARD && type !== 'markdown' && type !== 'canvas') {
        seen.add(type);
        results.push({ type, label: leaf.view?.getDisplayText?.() ?? type });
      }
    });
    console.debug('[Dashboard][View] Available plugin view types:', results.map(r => r.type));
    return results;
  }

  // ─── ZOOM & PAN ──────────────────────────────────────────────────────────

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
    // Ctrl+Wheel zoom
    this.viewportEl.addEventListener('wheel', (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? 0.1 : -0.1;
      this.changeZoom(delta);
    }, { passive: false });

    // Left-click drag to pan
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
  }

  // ─── LIFECYCLE ───────────────────────────────────────────────────────────

  async onClose() {
    console.debug('[Dashboard][View] onClose — restoring all leaves');
    this.widgetManager.restoreAll();
  }

  getState(): Record<string, unknown> {
    return {
      widgets: this.plugin.settings.widgets,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    if (Array.isArray(state.widgets)) {
      // Mutate in place to keep LayoutManager's reference valid
      this.plugin.settings.widgets.length = 0;
      this.plugin.settings.widgets.push(...state.widgets as WidgetConfig[]);
      console.debug('[Dashboard][View] setState applied:', this.plugin.settings.widgets.length, 'widgets');
    }
    if (typeof state.zoom === 'number') this.zoom = state.zoom;
    if (typeof state.panX === 'number') this.panX = state.panX;
    if (typeof state.panY === 'number') this.panY = state.panY;
    await super.setState(state, result);
  }
}