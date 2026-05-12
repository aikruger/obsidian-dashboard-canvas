import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DashboardView, VIEW_TYPE_DASHBOARD } from './view';
import { DEFAULT_SETTINGS, DashboardSettings } from './widget-config';

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

    this.addRibbonIcon('layout-dashboard', 'Open dashboard canvas', () => {
      this.activateDashboard().catch(console.error);
    });

    console.debug('[Dashboard] Plugin loaded, command registered');
  }

  onunload() {
    console.debug('[Dashboard] Plugin unloading — detaching all dashboard leaves');
    // eslint-disable-next-line obsidianmd/detach-leaves
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
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
