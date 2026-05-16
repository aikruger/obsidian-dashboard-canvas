import { App, Plugin, WorkspaceLeaf } from 'obsidian';
import { DashboardSettings, DEFAULT_SETTINGS } from "./widget-config";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./dashboard-view";

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings;

  async onload() {
    console.log("[Dashboard] Plugin loading");

    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_DASHBOARD,
      (leaf) => new DashboardView(leaf, this)
    );

    this.addRibbonIcon('layout-dashboard', 'Open Dashboard', () => {
      this.activateDashboard();
    });

    this.addCommand({
      id: 'open-dashboard',
      name: 'Open Dashboard',
      callback: () => {
        this.activateDashboard();
      }
    });

    console.log("[Dashboard] Plugin loaded");
  }

  async activateDashboard() {
    const { workspace } = this.app;

    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    if (existingLeaves.length > 0) {
      console.log("[Dashboard] activateDashboard — existing leaf found");
      if (existingLeaves[0]) workspace.revealLeaf(existingLeaves[0]);
      return;
    }

    console.log("[Dashboard] activateDashboard — new leaf created");
    const leaf = workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_DASHBOARD,
      active: true,
    });
    workspace.revealLeaf(leaf);
  }

  onunload() {
    console.log("[Dashboard] Plugin unloading");
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DashboardSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
