// settings-tab.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import DashboardPlugin from './main';
import { VIEW_TYPE_DASHBOARD } from './view';
import { DashboardView } from './view';

export class DashboardSettingTab extends PluginSettingTab {
  plugin: DashboardPlugin;

  constructor(app: App, plugin: DashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    console.debug('[Dashboard][Settings] DashboardSettingTab constructed');
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Dashboard Canvas Settings' });

    // ── Canvas Appearance ──────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Canvas Appearance' });

    new Setting(containerEl)
      .setName('Canvas background colour')
      .setDesc(
        'Choose a background colour for the dashboard canvas. ' +
        'Select "Default" to follow your Obsidian theme.'
      )
      .addColorPicker(picker => {
        // If the stored value is 'default' or empty, seed the picker with a
        // reasonable fallback so it opens on a valid colour.
        const currentValue = this.plugin.settings.canvasBackground;
        const seedColour = (currentValue && currentValue !== 'default')
          ? currentValue
          : '#1e1e1e';

        picker
          .setValue(seedColour)
          .onChange(async (value) => {
            console.debug('[Dashboard][Settings] canvasBackground changed to:', value);
            this.plugin.settings.canvasBackground = value;
            await this.plugin.saveSettings();
            this.applyCanvasBackground(value);
          });
      })
      .addButton(btn =>
        btn
          .setButtonText('Reset to default')
          .onClick(async () => {
            console.debug('[Dashboard][Settings] canvasBackground reset to default');
            this.plugin.settings.canvasBackground = 'default';
            await this.plugin.saveSettings();
            this.applyCanvasBackground('default');
          })
      );

    // ── Interaction ────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Interaction' });

    new Setting(containerEl)
      .setName('Alt + scroll → horizontal pan')
      .setDesc(
        'When enabled, holding Alt while scrolling the mouse wheel pans the canvas ' +
        'horizontally, regardless of which widget the cursor is over. ' +
        'Disable this if a widget you use already relies on Alt+scroll for its own purpose.'
      )
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.altScrollHorizontal)
          .onChange(async (value) => {
            console.debug('[Dashboard][Settings] altScrollHorizontal changed to:', value);
            this.plugin.settings.altScrollHorizontal = value;
            await this.plugin.saveSettings();
            // Live-update the open dashboard view without requiring a reload
            this.refreshOpenDashboardView();
          })
      );

    new Setting(containerEl)
      .setName('Horizontal scroll speed')
      .setDesc('How many pixels the canvas moves per wheel tick during Alt + scroll. Default: 40.')
      .addSlider(slider =>
        slider
          .setLimits(10, 200, 10)
          .setValue(this.plugin.settings.altScrollSpeed ?? 40)
          .setDynamicTooltip()
          .onChange(async (value) => {
            console.debug('[Dashboard][Settings] altScrollSpeed changed to:', value);
            this.plugin.settings.altScrollSpeed = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Grid ───────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Grid' });

    new Setting(containerEl)
      .setName('Snap widgets to grid')
      .setDesc('When enabled, widget positions snap to the grid when dropped.')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.snapToGrid)
          .onChange(async (value) => {
            console.debug('[Dashboard][Settings] snapToGrid changed to:', value);
            this.plugin.settings.snapToGrid = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Grid size (px)')
      .setDesc('Size of each grid cell in pixels. Default: 20.')
      .addSlider(slider =>
        slider
          .setLimits(10, 100, 5)
          .setValue(this.plugin.settings.gridSize ?? 20)
          .setDynamicTooltip()
          .onChange(async (value) => {
            console.debug('[Dashboard][Settings] gridSize changed to:', value);
            this.plugin.settings.gridSize = value;
            await this.plugin.saveSettings();
          })
      );
  }

  /**
   * Apply the canvas background to any open dashboard view immediately,
   * so the user sees the change without reopening the dashboard.
   */
  private applyCanvasBackground(colour: string): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    for (const leaf of leaves) {
      const view = leaf.view as DashboardView;
      if (view?.applyCanvasBackground) {
        view.applyCanvasBackground(colour);
        console.debug('[Dashboard][Settings] applyCanvasBackground called on open view:', colour);
      }
    }
  }

  /**
   * Tell any open dashboard view to re-read the altScrollHorizontal setting
   * and re-bind (or unbind) its Alt+wheel handler.
   */
  private refreshOpenDashboardView(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    for (const leaf of leaves) {
      const view = leaf.view as DashboardView;
      if (view?.refreshScrollBehaviour) {
        view.refreshScrollBehaviour();
        console.debug('[Dashboard][Settings] refreshScrollBehaviour called on open view');
      }
    }
  }
}