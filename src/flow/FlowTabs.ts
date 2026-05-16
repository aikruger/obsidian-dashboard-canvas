import { App, WorkspaceLeaf, Component } from "obsidian";
import { getLeafContainer } from "./FlowUtils";
import type ObsidianFlowPlugin from "../main";

export class FlowTabs extends Component {
    app: App;
    plugin: ObsidianFlowPlugin;
    containerEl: HTMLElement;
    tabsEl: HTMLElement;
    leavesEl: HTMLElement;

    leaves: WorkspaceLeaf[] = [];
    activeLeaf: WorkspaceLeaf | null = null;

    constructor(app: App, plugin: ObsidianFlowPlugin, containerEl: HTMLElement) {
        super();
        this.app = app;
        this.plugin = plugin;
        this.containerEl = containerEl;
        this.buildUI();
    }

    buildUI() {
        this.tabsEl = this.containerEl.createDiv('obsidian-flow-tabs');
        this.tabsEl.style.display = 'flex';
        this.tabsEl.style.backgroundColor = 'var(--background-secondary)';
        this.tabsEl.style.borderBottom = '1px solid var(--background-modifier-border)';
        this.tabsEl.style.overflowX = 'auto';

        this.leavesEl = this.containerEl.createDiv('obsidian-flow-leaves');
        this.leavesEl.style.flexGrow = '1';
        this.leavesEl.style.position = 'relative';
        this.leavesEl.style.overflow = 'hidden';
    }

    addLeaf(leaf: WorkspaceLeaf) {
        this.leaves.push(leaf);

        const tabEl = this.tabsEl.createDiv('obsidian-flow-tab');
        tabEl.style.padding = '5px 10px';
        tabEl.style.cursor = 'pointer';
        tabEl.style.borderRight = '1px solid var(--background-modifier-border)';
        tabEl.innerText = leaf.view?.getDisplayText() || 'New Tab';

        tabEl.onclick = () => {
            this.activateLeaf(leaf);
        };

        // Internal dragging support
        tabEl.draggable = true;
        tabEl.addEventListener('dragstart', (e) => {
            e.stopPropagation(); // prevent bubbling
            console.log('[obsidian-flow] Internal tab drag started', leaf.view?.getViewType());

            if (e.dataTransfer) {
                e.dataTransfer.setData('obsidian-flow-internal', leaf.view?.getViewType() ?? 'unknown');
            }

            this.plugin.currentDragSession = {
                type: leaf.view?.getViewType() ?? '',
                state: leaf.view?.getState?.() ?? {},
                eState: leaf.view?.getEphemeralState?.() ?? null,
                sourceInternal: true,
                sourceLeaf: leaf,
                sourceTabs: this
            };
        });

        const leafContainer = getLeafContainer(leaf);

        if (leafContainer) {
            leafContainer.style.position = 'absolute';
            leafContainer.style.top = '0';
            leafContainer.style.left = '0';
            leafContainer.style.width = '100%';
            leafContainer.style.height = '100%';
            leafContainer.style.display = 'none';
            this.leavesEl.appendChild(leafContainer);
        }

        this.activateLeaf(leaf);
    }

    removeLeaf(leaf: WorkspaceLeaf) {
        const idx = this.leaves.indexOf(leaf);
        if (idx === -1) {
            console.warn('[obsidian-flow] FlowTabs.removeLeaf: leaf not found');
            return;
        }
        this.leaves.splice(idx, 1);

        const tabEl = this.tabsEl.children[idx];
        if (tabEl) this.tabsEl.removeChild(tabEl);

        const lc = getLeafContainer(leaf);
        if (lc && lc.parentNode === this.leavesEl) {
            this.leavesEl.removeChild(lc);
        }

        if (this.leaves.length > 0) {
            const nextLeaf = this.leaves[Math.max(0, idx - 1)];
            if (nextLeaf) {
                this.activateLeaf(nextLeaf);
            }
        }
        console.log('[obsidian-flow] FlowTabs.removeLeaf: removed leaf', leaf.view?.getViewType());
    }

    activateLeaf(leaf: WorkspaceLeaf) {
        this.activeLeaf = leaf;

        this.leaves.forEach(l => {
            const lc = getLeafContainer(l);
            if (lc) lc.style.display = 'none';
        });

        const activeContainer = getLeafContainer(leaf);
        if (activeContainer) {
            activeContainer.style.display = 'block';
        }
    }
}
