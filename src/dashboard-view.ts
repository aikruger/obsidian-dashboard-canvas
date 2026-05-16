import { ItemView, WorkspaceLeaf, Menu, TFile } from "obsidian";
import type DashboardPlugin from "./main";
import { WidgetConfig } from "./widget-config";
import interact from "interactjs";

export const VIEW_TYPE_DASHBOARD = "dashboard-canvas-view";

export class DashboardView extends ItemView {
  plugin: DashboardPlugin;
  canvasEl: HTMLElement;
  // Map: widgetId -> WorkspaceLeaf
  mountedLeaves: Map<string, WorkspaceLeaf> = new Map();
  // Map: widgetId -> original location
  originalLocations: Map<string, { parent: HTMLElement; next: ChildNode | null }> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText(): string {
    return "Dashboard Canvas";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen() {
    const { containerEl } = this;
    const viewContent = containerEl.children[1] as HTMLElement;
    viewContent.empty();
    viewContent.style.display = "flex";
    viewContent.style.flexDirection = "column";

    // Toolbar
    const toolbarEl = viewContent.createDiv({ cls: "dc-toolbar" });
    const addWidgetBtn = toolbarEl.createEl("button", { text: "+ Add Widget", cls: "dc-btn" });
    addWidgetBtn.addEventListener("click", (e) => this.showAddWidgetMenu(e));

    // Canvas
    this.canvasEl = viewContent.createDiv({ cls: "dc-canvas" });

    // Render existing widgets
    for (const widget of this.plugin.settings.widgets) {
      await this.renderWidget(widget);
    }
  }

  async onClose() {
    // Restore all leaves
    for (const widgetId of Array.from(this.mountedLeaves.keys())) {
      this.restoreLeaf(widgetId);
    }
  }

  getState(): Record<string, unknown> {
    return { widgets: this.plugin.settings.widgets };
  }

  async setState(state: Record<string, unknown>, result: any): Promise<void> {
    if (state && Array.isArray(state.widgets)) {
      this.plugin.settings.widgets = state.widgets as WidgetConfig[];
      await this.plugin.saveSettings();
      // Only re-render if the canvas is already created (meaning onOpen has run)
      if (this.canvasEl) {
        this.canvasEl.empty();
        // Clear mounted leaves maps but don't call restore, since we are conceptually refreshing the view and they should be either destroyed or re-mounted
        // Actually, we must restore them to avoid losing them
        for (const widgetId of Array.from(this.mountedLeaves.keys())) {
            this.restoreLeaf(widgetId);
        }
        for (const widget of this.plugin.settings.widgets) {
          await this.renderWidget(widget);
        }
      }
    }
    super.setState(state, result);
  }

  async renderWidget(config: WidgetConfig) {
    // 1. Create slot DOM
    const slotEl = this.canvasEl.createDiv({ cls: "dc-slot" });
    slotEl.dataset.widgetId = config.id;
    slotEl.style.left = `${config.x}px`;
    slotEl.style.top = `${config.y}px`;
    slotEl.style.width = `${config.w}px`;
    slotEl.style.height = `${config.h}px`;

    const titlebarEl = slotEl.createDiv({ cls: "dc-slot-titlebar dc-drag-handle" });
    titlebarEl.createSpan({ cls: "dc-slot-label", text: config.label });

    const closeBtn = titlebarEl.createEl("button", { cls: "dc-slot-close", text: "X" });
    closeBtn.addEventListener("click", () => this.removeWidget(config.id));

    const slotContentEl = slotEl.createDiv({ cls: "dc-slot-content" });
    slotEl.createDiv({ cls: "dc-resize-handle" });

    this.attachInteract(slotEl, config);

    // 2. Acquire leaf
    if (this.mountedLeaves.has(config.id)) {
      console.log(`[Dashboard] Widget "${config.id}" already mounted.`);
      return;
    }

    let targetLeaf: WorkspaceLeaf | null = null;
    let method = "existing";

    const existingLeaves = this.app.workspace.getLeavesOfType(config.viewType);

    // Find an existing leaf that isn't already mounted in our dashboard
    for (const leaf of existingLeaves) {
      // check if it's already mounted in another widget
      let alreadyMounted = false;
      for (const [mountedId, mountedLeaf] of this.mountedLeaves.entries()) {
          if (mountedLeaf === leaf) {
              alreadyMounted = true;
              break;
          }
      }
      if (!alreadyMounted) {
          targetLeaf = leaf;
          break;
      }
    }

    if (!targetLeaf) {
      method = "created";
      if (config.viewType === "markdown" && config.filePath) {
        targetLeaf = this.app.workspace.getLeaf(false); // get new leaf without splitting? No, getLeaf(false) replaces active leaf? Wait, we want a detached leaf maybe? No, specification says:
        // "For viewType === 'markdown' with a filePath: call app.workspace.getLeaf(false) then leaf.openFile(file). Wait one tick."
        // Wait, app.workspace.getLeaf(false) normally replaces the active leaf (which is our dashboard!), but maybe it works. Let's do getLeaf('window')? Wait, the spec says exactly getLeaf(false).
        targetLeaf = this.app.workspace.getLeaf(false);
        const file = this.app.vault.getAbstractFileByPath(config.filePath);
        if (file instanceof TFile) {
          await targetLeaf.openFile(file);
          await new Promise(r => setTimeout(r, 0));
        } else {
            console.log(`[Dashboard] File not found: ${config.filePath}`);
            slotContentEl.createDiv({ text: "File not found" });
            return;
        }
      } else {
        targetLeaf = this.app.workspace.getRightLeaf(false);
        if (!targetLeaf) {
          console.warn(`[Dashboard] Failed to acquire right leaf for "${config.viewType}"`);
          slotContentEl.createDiv({ text: "Error: Could not acquire leaf." });
          return;
        }
        try {
          await targetLeaf.setViewState({ type: config.viewType });
          await new Promise(r => setTimeout(r, 150));
        } catch (e) {
          console.warn(`[Dashboard] Failed to setViewState for "${config.viewType}"`, e);
          slotContentEl.createDiv({ text: "Error: Could not load view." });
          return;
        }
      }
    }

    console.log(`[Dashboard] Acquired leaf for widget "${config.id}" viewType="${config.viewType}" method=${method}`);

    // 3. Mount leaf
    this.mountLeaf(targetLeaf, slotContentEl, config.id);
  }

  mountLeaf(leaf: WorkspaceLeaf, slotContentEl: HTMLElement, widgetId: string): void {
    const el = (leaf as any).containerEl;
    // Save original location for restoration
    this.originalLocations.set(widgetId, { parent: el.parentElement!, next: el.nextSibling });
    // Move into slot
    slotContentEl.appendChild(el);
    // Force fill
    el.style.cssText = "width:100%;height:100%;overflow:auto;position:relative;flex:1;";
    this.mountedLeaves.set(widgetId, leaf);
    console.log(`[Dashboard] Mounted leaf for widget "${widgetId}"`);
  }

  restoreLeaf(widgetId: string): void {
    const leaf = this.mountedLeaves.get(widgetId);
    const loc = this.originalLocations.get(widgetId);
    if (!leaf) return;
    if (loc?.parent) {
      loc.parent.insertBefore((leaf as any).containerEl, loc.next);
      console.log(`[Dashboard] Restored leaf for widget "${widgetId}" to original parent`);
    } else {
      leaf.detach();
      console.log(`[Dashboard] Detached leaf for widget "${widgetId}" (no original parent)`);
    }
    this.mountedLeaves.delete(widgetId);
    this.originalLocations.delete(widgetId);
  }

  async removeWidget(widgetId: string) {
    this.restoreLeaf(widgetId);
    this.plugin.settings.widgets = this.plugin.settings.widgets.filter(w => w.id !== widgetId);
    await this.plugin.saveSettings();
    const slotEl = this.canvasEl.querySelector(`[data-widget-id="${widgetId}"]`);
    if (slotEl) {
      slotEl.remove();
    }
  }

  attachInteract(slotEl: HTMLElement, config: WidgetConfig): void {
    interact(slotEl)
      .draggable({
        allowFrom: ".dc-drag-handle",
        listeners: {
          move: (event) => {
            config.x += event.dx;
            config.y += event.dy;
            slotEl.style.left = config.x + "px";
            slotEl.style.top  = config.y + "px";
          },
          end: () => {
            console.log(`[Dashboard] Drag end widget "${config.id}" x=${config.x} y=${config.y}`);
            this.plugin.saveSettings();
          },
        },
      })
      .resizable({
        edges: { bottom: ".dc-resize-handle", right: ".dc-resize-handle" },
        modifiers: [interact.modifiers.restrictSize({ min: { width: 220, height: 160 } })],
        listeners: {
          move: (event) => {
            config.w = event.rect.width;
            config.h = event.rect.height;
            slotEl.style.width  = config.w + "px";
            slotEl.style.height = config.h + "px";
          },
          end: () => {
            console.log(`[Dashboard] Resize end widget "${config.id}" w=${config.w} h=${config.h}`);
            this.plugin.saveSettings();
          },
        },
      });
  }

  showAddWidgetMenu(e: MouseEvent) {
    const menu = new Menu();

    const viewTypes = new Set<string>();
    this.app.workspace.iterateAllLeaves(leaf => {
      const type = leaf.getViewState().type;
      if (type !== VIEW_TYPE_DASHBOARD && type !== "empty") {
        viewTypes.add(type);
      }
    });

    for (const viewType of Array.from(viewTypes)) {
      menu.addItem((item) => {
        item
          .setTitle(`Add ${viewType}`)
          .onClick(async () => {
            await this.addWidget(viewType, viewType);
          });
      });
    }

    menu.showAtMouseEvent(e);
  }

  async addWidget(viewType: string, label: string) {
    const config: WidgetConfig = {
      id: `widget-${Date.now()}`,
      viewType,
      label,
      x: 50,
      y: 50,
      w: 600,
      h: 400
    };
    this.plugin.settings.widgets.push(config);
    await this.plugin.saveSettings();
    await this.renderWidget(config);
  }
}
