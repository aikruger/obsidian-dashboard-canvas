import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DashboardView, VIEW_TYPE_DASHBOARD } from './view';
import { DEFAULT_SETTINGS, DashboardSettings } from './widget-config';
import { DashboardSettingTab } from './settings-tab';

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings;

  async onload() {
    console.debug('[Dashboard] Plugin loading');

    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_DASHBOARD,
      (leaf) => new DashboardView(leaf, this)
    );

    this.addCommand({
      id: 'open-dashboard',
      name: 'Open dashboard canvas',
      callback: () => {
        this.activateDashboard().catch(console.error);
      },
    });

    this.addCommand({
      id: 'add-active-view-to-dashboard',
      name: 'Add active view to dashboard canvas',
      callback: () => {
        console.debug('[Dashboard] add-active-view-to-dashboard command fired');
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
        if (leaves.length === 0) {
          console.warn('[Dashboard] Dashboard not open — open it first');
          return;
        }
        const dashView = leaves[0]?.view as DashboardView;
        if (dashView) {
          dashView.addActiveViewToDashboard();
        }
      },
    });

    this.addRibbonIcon('layout-dashboard', 'Open dashboard canvas', () => {
      this.activateDashboard().catch(console.error);
    });

    // NEW — register the settings tab
    this.addSettingTab(new DashboardSettingTab(this.app, this));
    console.debug('[Dashboard] Settings tab registered');

    console.debug('[Dashboard] Plugin loaded, command registered');
  }

  onunload() {
    console.debug('[Dashboard] Plugin unloading — detaching all dashboard leaves');

  }

  async activateDashboard() {
    console.debug('[Dashboard] activateDashboard called');
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);

    if (leaves.length > 0 && leaves[0] !== undefined) {
      leaf = leaves[0];
      console.debug('[Dashboard] Existing dashboard leaf found — revealing');
    } else {
      leaf = workspace.getLeaf(false);
      console.debug('[Dashboard] Creating new dashboard leaf');
      await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as DashboardSettings);
    console.debug('[Dashboard] Settings loaded:', JSON.stringify(this.settings));
  }

  async saveSettings() {
    await this.saveData(this.settings);
    console.debug('[Dashboard] Settings saved');
  }
}
