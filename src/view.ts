import { ItemView, WorkspaceLeaf, Menu, TFile } from 'obsidian';
import DashboardPlugin from './main';
import { WidgetConfig } from './widget-config';
import { WidgetManager } from './widget-manager';
import { LayoutManager } from './layout-manager';

export const VIEW_TYPE_DASHBOARD = 'dashboard-canvas-view';

export class DashboardView extends ItemView {
  plugin: DashboardPlugin;
  widgetManager: WidgetManager;
  layoutManager: LayoutManager;
  canvasEl: HTMLElement;

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
    console.debug('[Dashboard][View] onOpen — building canvas');
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.classList.add('dashboard-container');

    // Canvas
    this.canvasEl = container.createDiv({ cls: 'dashboard-canvas' });

    // Toolbar
    const toolbar = container.createDiv({ cls: 'dashboard-toolbar' });
    this.buildToolbar(toolbar);

    // Layout manager
    this.layoutManager = new LayoutManager(
      this.canvasEl,
      this.plugin.settings.widgets,
      async (widgets) => {
        this.plugin.settings.widgets = widgets;
        await this.plugin.saveSettings();
      }
    );

    // Render all configured widgets
    for (const config of this.plugin.settings.widgets) {
      await this.renderWidget(config);
    }

    console.debug('[Dashboard][View] onOpen complete — rendered', this.plugin.settings.widgets.length, 'widgets');
  }

  async renderWidget(config: WidgetConfig) {
    console.debug(`[Dashboard][View] Rendering widget "${config.id}" (${config.viewType})`);

    const slot = this.canvasEl.createDiv({ cls: 'dashboard-widget-slot' });
    slot.dataset.widgetId = config.id;
    this.layoutManager.applyToSlot(slot, config);

    // Title bar
    const titleBar = slot.createDiv({ cls: 'dashboard-widget-titlebar' });
    const handle = titleBar.createDiv({ cls: 'dashboard-widget-handle' });
    handle.createEl('span', { text: '⠿', cls: 'dashboard-widget-drag-icon' });
    titleBar.createEl('span', { text: config.label, cls: 'dashboard-widget-label' });

    const closeBtn = titleBar.createEl('button', { text: '✕', cls: 'dashboard-widget-close' });
    closeBtn.addEventListener('click', () => this.removeWidget(config.id));

    // Content frame
    const contentFrame = slot.createDiv({ cls: 'dashboard-widget-content' });

    // Get/create leaf and mount
    const leaf = await this.widgetManager.getOrCreateLeaf(config);
    if (leaf) {
      this.widgetManager.mountLeaf(leaf, contentFrame, config.id);
    } else {
      contentFrame.createEl('p', {
        text: `Could not load view type: ${config.viewType}`,
        cls: 'dashboard-widget-error',
      });
      console.warn(`[Dashboard][View] Failed to acquire leaf for widget "${config.id}"`);
    }

    this.layoutManager.attachInteract(slot, config);
    console.debug(`[Dashboard][View] Widget "${config.id}" render complete`);
  }

  async addWidget(viewType: string, label: string, filePath?: string) {
    console.debug(`[Dashboard][View] Adding widget: viewType="${viewType}", label="${label}"`);
    const newConfig: WidgetConfig = {
      id: `widget-${Date.now()}`,
      viewType,
      label,
      x: 50,
      y: 50,
      w: 600,
      h: 400,
      filePath
    };
    this.plugin.settings.widgets.push(newConfig);
    await this.plugin.saveSettings();
    await this.renderWidget(newConfig);
  }

  async addWidgetViaCommand(commandId: string, label: string, viewType: string) {
    console.debug(`[Dashboard][View] addWidgetViaCommand: commandId="${commandId}"`);
    await (this.app as unknown as { commands: { executeCommandById: (id: string) => Promise<void> } }).commands.executeCommandById(commandId);

    // Give the plugin a render cycle to create the leaf
    await new Promise(resolve => window.setTimeout(resolve, 150));

    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length === 0) {
      console.warn(`[Dashboard][View] No leaf found after executing command "${commandId}"`);
      return;
    }
    await this.addWidget(viewType, label);
  }

  async removeWidget(widgetId: string) {
    console.debug(`[Dashboard][View] Removing widget "${widgetId}"`);
    this.widgetManager.restoreLeaf(widgetId);
    const slot = this.canvasEl.querySelector(`[data-widget-id="${widgetId}"]`);
    if (slot) slot.remove();
    this.plugin.settings.widgets = this.plugin.settings.widgets.filter(w => w.id !== widgetId);
    await this.plugin.saveSettings();
  }

  buildToolbar(toolbarEl: HTMLElement) {
    const addBtn = toolbarEl.createEl('button', { text: '+ Add widget', cls: 'dashboard-toolbar-btn' });
    addBtn.addEventListener('click', (evt) => this.openAddWidgetMenu(evt));

    const saveBtn = toolbarEl.createEl('button', { text: '💾 Save layout', cls: 'dashboard-toolbar-btn' });
    saveBtn.addEventListener('click', () => {
      this.plugin.saveSettings().catch(console.error);
      console.debug('[Dashboard][View] Layout manually saved');
    });
  }

  getAllRegisteredViewTypes(): Array<{ type: string; label: string }> {
    const results: Array<{ type: string; label: string }> = [];

    // Method 1: iterate workspace leaves
    const seen = new Set<string>();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const type = leaf.getViewState().type;
      if (!seen.has(type)) {
        seen.add(type);
        results.push({ type, label: leaf.view?.getDisplayText?.() || type });
      }
    });

    // Method 2: check internal plugin manifests + command palette for view-opening commands
    // (app as any).plugins.plugins gives access to all enabled plugin instances
    const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
    if (plugins) {
      for (const [pluginId, plugin] of Object.entries(plugins)) {
        // Each plugin may expose activateView or viewType constants
        console.debug(`[Dashboard] Plugin "${pluginId}" loaded`);
      }
    }

    console.debug('[Dashboard] Discovered view types:', results.map(r => r.type));
    return results;
  }

  openAddWidgetMenu(evt: MouseEvent) {
    const menu = new Menu();

    const allLeafTypes = this.getAllRegisteredViewTypes();

    for (const viewType of allLeafTypes) {
      if (viewType.type === VIEW_TYPE_DASHBOARD) continue;
      menu.addItem(item =>
        item
          .setTitle(viewType.type)
          .onClick(() => this.addWidget(viewType.type, viewType.label))
      );
    }

    menu.addSeparator();
    menu.addItem(item =>
      item.setTitle('Markdown note…').onClick(() => {
        // For now, prompt for a file name and try to add it. A real plugin would use a file suggester modal.
        const path = window.prompt("Enter markdown file path (e.g. MyNote.md):");
        if (path) {
          this.addWidget('markdown', path, path).catch(console.error);
        }
      })
    );

    menu.showAtMouseEvent(evt);
  }

  async onClose() {
    console.debug('[Dashboard][View] onClose — restoring all mounted leaves');
    this.widgetManager.restoreAll();
  }

  getState(): Record<string, unknown> {
    return { widgets: this.plugin.settings.widgets };
  }

  async setState(state: Record<string, unknown>, result: import('obsidian').ViewStateResult): Promise<void> {
    if (state.widgets) {
      this.plugin.settings.widgets = state.widgets as WidgetConfig[];
    }
    await super.setState(state, result);
  }
}
