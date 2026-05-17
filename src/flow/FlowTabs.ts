import { App, WorkspaceLeaf, Component } from "obsidian";
import { getLeafContainer } from "./FlowUtils";
import type ObsidianFlowPlugin from "../main";
import type { DropMode } from "./FlowSplit";

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
    placeholderEl: HTMLElement | null = null;

    dropZoneEls: Record<string, HTMLElement> = {};
    onSplitDrop: ((targetTabs: FlowTabs, mode: DropMode) => void) | null = null;
    onTabDrop: ((targetTabs: FlowTabs) => void) | null = null;
    mode: 'design' | 'use' = 'design';

    constructor(app: App, plugin: ObsidianFlowPlugin, containerEl: HTMLElement) {
        super();
        this.app = app;
        this.plugin = plugin;
        this.containerEl = containerEl;
        this.buildUI();
        this.showEmptyState();
        this.buildDropZones();
        this.setMode('design');
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

    buildDropZones() {
        const edges = ['top', 'bottom', 'left', 'right'] as const;
        const modeMap = {
            top: 'split-top', bottom: 'split-bottom',
            left: 'split-left', right: 'split-right',
        } as const;

        for (const edge of edges) {
            const zone = this.leavesEl.createDiv(`obsidian-flow-dropzone-${edge}`);
            zone.style.position = 'absolute';
            zone.style.display = 'none';
            zone.style.zIndex = '100';
            zone.style.backgroundColor = 'var(--interactive-accent)';
            zone.style.opacity = '0';
            zone.style.transition = 'opacity 0.1s';
            zone.style.pointerEvents = 'none';

            if (edge === 'top' || edge === 'bottom') {
                zone.style.left = '10%';
                zone.style.width = '80%';
                zone.style.height = '28%';
                zone.style.borderRadius = '6px';
                if (edge === 'top') zone.style.top = '6%';
                else zone.style.bottom = '6%';
            } else {
                zone.style.top = '10%';
                zone.style.height = '80%';
                zone.style.width = '28%';
                zone.style.borderRadius = '6px';
                if (edge === 'left') zone.style.left = '6%';
                else zone.style.right = '6%';
            }

            zone.addEventListener('dragover', (e) => {
                if (!this.plugin.currentDragSession) return;
                e.preventDefault();
                e.stopPropagation();
                zone.style.opacity = '0.55';
            });

            zone.addEventListener('dragleave', () => {
                zone.style.opacity = '0.3';
            });

            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.style.opacity = '0';
                console.log('[obsidian-flow] FlowTabs drop zone drop', edge);
                if (this.onSplitDrop) {
                    this.onSplitDrop(this, modeMap[edge] as DropMode);
                }
            });

            this.dropZoneEls[edge] = zone;
        }

        const centre = this.leavesEl.createDiv('obsidian-flow-dropzone-centre');
        centre.style.position = 'absolute';
        centre.style.top = '33%';
        centre.style.left = '25%';
        centre.style.width = '50%';
        centre.style.height = '33%';
        centre.style.display = 'none';
        centre.style.zIndex = '100';
        centre.style.backgroundColor = 'var(--interactive-accent)';
        centre.style.opacity = '0';
        centre.style.transition = 'opacity 0.1s';
        centre.style.borderRadius = '6px';
        centre.style.pointerEvents = 'none';

        centre.addEventListener('dragover', (e) => {
            if (!this.plugin.currentDragSession) return;
            e.preventDefault();
            e.stopPropagation();
            centre.style.opacity = '0.55';
        });

        centre.addEventListener('dragleave', () => { centre.style.opacity = '0.3'; });

        centre.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            centre.style.opacity = '0';
            console.log('[obsidian-flow] FlowTabs centre drop — adding as tab');
            if (this.onTabDrop) this.onTabDrop(this);
        });

        this.dropZoneEls['centre'] = centre;
        console.log('[obsidian-flow] FlowTabs.buildDropZones: built for tabs instance');
    }

    showDropZones() {
        for (const zone of Object.values(this.dropZoneEls)) {
            zone.style.display = 'block';
            zone.style.pointerEvents = 'auto';
            zone.style.opacity = '0.3';
        }
        console.log('[obsidian-flow] FlowTabs.showDropZones');
    }

    hideDropZones() {
        for (const zone of Object.values(this.dropZoneEls)) {
            zone.style.display = 'none';
            zone.style.pointerEvents = 'none';
            zone.style.opacity = '0';
        }
    }

    setMode(mode: 'design' | 'use') {
        this.mode = mode;
        console.log('[obsidian-flow] FlowTabs.setMode', mode);

        this.containerEl.style.outline = mode === 'design'
            ? '1px solid var(--background-modifier-border-hover)'
            : 'none';

        if (mode === 'design' && this.leaves.length === 0) {
            this.showPlaceholder();
        } else if (mode === 'use') {
            this.hidePlaceholder();
        }

        this.hideDropZones();
    }

    showPlaceholder() {
        if (this.placeholderEl) return;
        this.placeholderEl = this.leavesEl.createDiv('obsidian-flow-placeholder');
        this.placeholderEl.style.position = 'absolute';
        this.placeholderEl.style.inset = '8px';
        this.placeholderEl.style.border = '2px dashed var(--background-modifier-border)';
        this.placeholderEl.style.borderRadius = '6px';
        this.placeholderEl.style.display = 'flex';
        this.placeholderEl.style.flexDirection = 'column';
        this.placeholderEl.style.alignItems = 'center';
        this.placeholderEl.style.justifyContent = 'center';
        this.placeholderEl.style.gap = '8px';
        this.placeholderEl.style.color = 'var(--text-faint)';
        this.placeholderEl.style.pointerEvents = 'none';

        const icon = this.placeholderEl.createDiv();
        icon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6M12 9v6"/></svg>`;

        const label = this.placeholderEl.createDiv();
        label.innerText = 'Drop a tab here';
        label.style.fontSize = '12px';

        console.log('[obsidian-flow] FlowTabs.showPlaceholder');
    }

    hidePlaceholder() {
        if (this.placeholderEl && this.placeholderEl.parentNode === this.leavesEl) {
            this.leavesEl.removeChild(this.placeholderEl);
            this.placeholderEl = null;
            console.log('[obsidian-flow] FlowTabs.hidePlaceholder');
        }
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
        if (this.mode === 'design') this.hidePlaceholder();
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

        tabEl.draggable = true;
        tabEl.addEventListener('dragstart', (e) => {
            e.stopPropagation();
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
                sourceTabs: this, leaf: leaf
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

        const tabEl = this.leafTabMap.get(leaf);
        if (tabEl && tabEl.parentNode === this.tabsEl) {
            this.tabsEl.removeChild(tabEl);
            console.log('[obsidian-flow] FlowTabs.removeLeaf: tab header removed');
        } else {
            console.warn('[obsidian-flow] FlowTabs.removeLeaf: tab header not found in DOM');
        }
        this.leafTabMap.delete(leaf);

        const lc = getLeafContainer(leaf);
        if (lc && lc.parentNode === this.leavesEl) {
            this.leavesEl.removeChild(lc);
            console.log('[obsidian-flow] FlowTabs.removeLeaf: leaf container removed');
        } else {
            console.warn('[obsidian-flow] FlowTabs.removeLeaf: leaf container not found in leavesEl');
        }

        try {
            leaf.detach();
            console.log('[obsidian-flow] FlowTabs.removeLeaf: leaf detached from workspace');
        } catch (error) {
            console.error('[obsidian-flow] FlowTabs.removeLeaf: leaf.detach() threw', error);
        }

        this.leaves.splice(idx, 1);

        if (this.leaves.length > 0) {
            const nextIdx = Math.max(0, idx - 1);
            const nextLeaf = this.leaves[nextIdx];
            if (nextLeaf) {
                this.activateLeaf(nextLeaf);
                console.log('[obsidian-flow] FlowTabs.removeLeaf: activated adjacent leaf', nextLeaf.view?.getViewType());
            }
        } else {
            this.showEmptyState();
            if (this.mode === 'design') this.showPlaceholder();
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
