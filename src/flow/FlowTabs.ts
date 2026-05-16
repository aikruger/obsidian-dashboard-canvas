import { App, WorkspaceLeaf, Component } from "obsidian";
import { getLeafContainer } from "./FlowUtils";

export class FlowTabs extends Component {
    app: App;
    containerEl: HTMLElement;
    tabsEl: HTMLElement;
    leavesEl: HTMLElement;

    leaves: WorkspaceLeaf[] = [];
    activeLeaf: WorkspaceLeaf | null = null;

    constructor(app: App, containerEl: HTMLElement) {
        super();
        this.app = app;
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
