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
    leafTabMap: Map<WorkspaceLeaf, HTMLElement> = new Map();
    emptyStateEl: HTMLElement | null = null;

    constructor(app: App, plugin: ObsidianFlowPlugin, containerEl: HTMLElement) {
        super();
        this.app = app;
        this.plugin = plugin;
        this.containerEl = containerEl;
        this.buildUI();
        this.showEmptyState();
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

    showEmptyState() {
        if (this.emptyStateEl) return;
        this.emptyStateEl = this.leavesEl.createDiv('obsidian-flow-empty-state');
        this.emptyStateEl.style.display = 'flex';
        this.emptyStateEl.style.flexDirection = 'column';
        this.emptyStateEl.style.alignItems = 'center';
        this.emptyStateEl.style.justifyContent = 'center';
        this.emptyStateEl.style.height = '100%';
        this.emptyStateEl.style.color = 'var(--text-muted)';
        this.emptyStateEl.style.gap = '8px';

        const icon = this.emptyStateEl.createDiv();
        icon.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6M12 9v6"/></svg>`;

        const msg = this.emptyStateEl.createDiv();
        msg.innerText = 'Drop a tab here or click + to add one';
        msg.style.fontSize = 'var(--font-ui-small)';

        console.log('[obsidian-flow] FlowTabs.showEmptyState: empty state shown');
    }

    hideEmptyState() {
        if (this.emptyStateEl && this.emptyStateEl.parentNode === this.leavesEl) {
            this.leavesEl.removeChild(this.emptyStateEl);
            this.emptyStateEl = null;
            console.log('[obsidian-flow] FlowTabs.hideEmptyState: empty state removed');
        }
    }

    addLeaf(leaf: WorkspaceLeaf) {
        this.hideEmptyState();
        this.leaves.push(leaf);

        const tabEl = this.tabsEl.createDiv('obsidian-flow-tab');
        tabEl.style.display = 'flex';
        tabEl.style.alignItems = 'center';
        tabEl.style.padding = '4px 8px';
        tabEl.style.cursor = 'pointer';
        tabEl.style.borderRight = '1px solid var(--background-modifier-border)';
        tabEl.style.gap = '6px';
        tabEl.style.userSelect = 'none';
        tabEl.style.whiteSpace = 'nowrap';

        const labelEl = tabEl.createSpan();
        labelEl.innerText = leaf.view?.getDisplayText() || 'New Tab';

        const closeBtn = tabEl.createEl('button');
        closeBtn.innerText = '×';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.padding = '0 2px';
        closeBtn.style.lineHeight = '1';
        closeBtn.style.fontSize = '14px';
        closeBtn.style.color = 'var(--text-muted)';
        closeBtn.style.borderRadius = '2px';
        closeBtn.setAttribute('aria-label', 'Remove tab');
        closeBtn.style.opacity = '0';
        tabEl.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; });
        tabEl.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0'; });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[obsidian-flow] Tab close button clicked', leaf.view?.getViewType());
            this.removeLeaf(leaf);
        });

        tabEl.onclick = () => {
            this.activateLeaf(leaf);
        };

        this.leafTabMap.set(leaf, tabEl);

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
        console.log('[obsidian-flow] FlowTabs.addLeaf: leaf added', leaf.view?.getViewType());
    }

    removeLeaf(leaf: WorkspaceLeaf) {
        console.log('[obsidian-flow] FlowTabs.removeLeaf invoked', leaf.view?.getViewType());

        const idx = this.leaves.indexOf(leaf);
        if (idx === -1) {
            console.warn('[obsidian-flow] FlowTabs.removeLeaf: leaf not in this group');
            return;
        }

        // Remove tab header via map
        const tabEl = this.leafTabMap.get(leaf);
        if (tabEl && tabEl.parentNode === this.tabsEl) {
            this.tabsEl.removeChild(tabEl);
            console.log('[obsidian-flow] FlowTabs.removeLeaf: tab header removed');
        } else {
            console.warn('[obsidian-flow] FlowTabs.removeLeaf: tab header not found in DOM');
        }
        this.leafTabMap.delete(leaf);

        // Remove leaf container from leavesEl
        const lc = getLeafContainer(leaf);
        if (lc && lc.parentNode === this.leavesEl) {
            this.leavesEl.removeChild(lc);
            console.log('[obsidian-flow] FlowTabs.removeLeaf: leaf container removed');
        } else {
            console.warn('[obsidian-flow] FlowTabs.removeLeaf: leaf container not found in leavesEl');
        }

        // Detach the leaf from Obsidian's workspace so it doesn't linger
        try {
            leaf.detach();
            console.log('[obsidian-flow] FlowTabs.removeLeaf: leaf detached from workspace');
        } catch (error) {
            console.error('[obsidian-flow] FlowTabs.removeLeaf: leaf.detach() threw', error);
        }

        this.leaves.splice(idx, 1);

        // Activate adjacent leaf if any remain
        if (this.leaves.length > 0) {
            const nextIdx = Math.max(0, idx - 1);
            const nextLeaf = this.leaves[nextIdx];
            if (nextLeaf) {
                this.activateLeaf(nextLeaf);
                console.log('[obsidian-flow] FlowTabs.removeLeaf: activated adjacent leaf', nextLeaf.view?.getViewType());
            }
        } else {
            // No leaves left — show empty state
            this.showEmptyState();
            console.log('[obsidian-flow] FlowTabs.removeLeaf: no leaves remain, showing empty state');
        }
    }

    clearAll() {
        console.log('[obsidian-flow] FlowTabs.clearAll invoked, leaves:', this.leaves.length);
        const allLeaves = [...this.leaves];
        for (const leaf of allLeaves) {
            this.removeLeaf(leaf);
        }
        console.log('[obsidian-flow] FlowTabs.clearAll complete');
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
