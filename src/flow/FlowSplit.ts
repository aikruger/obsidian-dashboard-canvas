import { App, Component } from "obsidian";
import { FlowTabs } from "./FlowTabs";
import type ObsidianFlowPlugin from "../main";

export type DropMode = 'tab' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom';
export type SplitDropCallback = (targetTabs: FlowTabs, mode: DropMode) => void;

export class FlowSplit extends Component {
    app: App;
    plugin: ObsidianFlowPlugin;
    containerEl: HTMLElement;
    direction: 'horizontal' | 'vertical';
    children: (FlowSplit | FlowTabs)[];
    onDrop: SplitDropCallback | null = null;
    mode: 'design' | 'use' = 'design';
    dividerEls: HTMLElement[] = [];

    private resizeState = {
        active: false,
        dividerIndex: -1,
        startPos: 0,
        startSizeA: 0,
        startSizeB: 0,
        totalSize: 0
    };

    constructor(app: App, plugin: ObsidianFlowPlugin, containerEl: HTMLElement, direction: 'horizontal' | 'vertical' = 'horizontal') {
        super();
        this.app = app;
        this.plugin = plugin;
        this.containerEl = containerEl;
        this.direction = direction;
        this.children = [];
        this.buildUI();
    }

    buildUI() {
        this.containerEl.style.display = 'flex';
        this.containerEl.style.flexDirection = this.direction === 'horizontal' ? 'row' : 'column';
        this.containerEl.style.width = '100%';
        this.containerEl.style.height = '100%';
        this.containerEl.style.position = 'relative';
    }

    setMode(mode: 'design' | 'use') {
        this.mode = mode;
        console.log('[obsidian-flow] FlowSplit.setMode', mode);

        for (const divider of this.dividerEls) {
            divider.style.cursor = mode === 'design'
                ? (this.direction === 'horizontal' ? 'col-resize' : 'row-resize')
                : 'default';
            divider.style.pointerEvents = mode === 'design' ? 'auto' : 'none';
        }

        if (mode === 'design') this.hideAllDropZones();

        for (const child of this.children) {
            if (child instanceof FlowSplit) child.setMode(mode);
        }
    }

    findTabsForDropZone(): FlowTabs | null {
        for (const child of this.children) {
            if (child instanceof FlowTabs) return child;
        }
        for (const child of this.children) {
            if (child instanceof FlowSplit) {
                const found = child.findTabsForDropZone();
                if (found) return found;
            }
        }
        return null;
    }

    showAllDropZones() {
        this.children.forEach(c => {
            if (c instanceof FlowSplit) c.showAllDropZones();
            else if (c instanceof FlowTabs) c.showDropZones();
        });
    }

    hideAllDropZones() {
        this.children.forEach(c => {
            if (c instanceof FlowSplit) c.hideAllDropZones();
            else if (c instanceof FlowTabs) c.hideDropZones();
        });
    }

    addTabs(tabs: FlowTabs) {
        this.children.push(tabs);
        tabs.containerEl.style.flex = '1 1 0%';
        this.containerEl.appendChild(tabs.containerEl);
    }

    addSplit(split: FlowSplit) {
        this.children.push(split);
        split.containerEl.style.flex = '1 1 0%';
        this.containerEl.appendChild(split.containerEl);
    }

    removeTabs(tabs: FlowTabs) {
        const idx = this.children.indexOf(tabs);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            if (tabs.containerEl.parentNode === this.containerEl) {
                this.containerEl.removeChild(tabs.containerEl);
            }
            console.log('[obsidian-flow] FlowSplit.removeTabs: removed', idx);
        } else {
            console.warn('[obsidian-flow] FlowSplit.removeTabs: target not found');
        }
    }

    splitAt(targetTabs: FlowTabs, mode: DropMode): FlowTabs {
        console.log('[obsidian-flow] FlowSplit.splitAt', { mode });

        const newDirection: 'horizontal' | 'vertical' =
            (mode === 'split-left' || mode === 'split-right') ? 'horizontal' : 'vertical';

        this.removeTabs(targetTabs);

        const wrapperEl = document.createElement('div');
        wrapperEl.style.flex = '1 1 0%';
        wrapperEl.style.display = 'flex';
        wrapperEl.style.width = '100%';
        wrapperEl.style.height = '100%';

        const wrapperSplit = new FlowSplit(this.app, this.plugin, wrapperEl, newDirection);
        wrapperSplit.onDrop = this.onDrop;

        const newTabsEl = document.createElement('div');
        newTabsEl.style.flex = '1 1 0%';
        newTabsEl.style.display = 'flex';
        newTabsEl.style.flexDirection = 'column';
        const newTabs = new FlowTabs(this.app, this.plugin, newTabsEl);

        if (mode === 'split-left' || mode === 'split-top') {
            wrapperSplit.addTabs(newTabs);
            wrapperSplit.addTabs(targetTabs);
            wrapperSplit.addDivider(0);
        } else {
            wrapperSplit.addTabs(targetTabs);
            wrapperSplit.addTabs(newTabs);
            wrapperSplit.addDivider(0);
        }

        this.addSplit(wrapperSplit);
        this.containerEl.appendChild(wrapperEl);

        console.log('[obsidian-flow] FlowSplit.splitAt: new split created', { direction: newDirection });
        return newTabs;
    }

    initResizeController() {
        this.containerEl.addEventListener('mousemove', (e) => {
            if (!this.resizeState.active) return;
            const currentPos = this.direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPos - this.resizeState.startPos;

            const idx = this.resizeState.dividerIndex;
            const childA = this.children[idx];
            const childB = this.children[idx + 1];
            if (!childA || !childB) return;

            const elA = childA.containerEl;
            const elB = childB.containerEl;
            const total = this.resizeState.totalSize;
            const newRatio = Math.max(0.1, Math.min(0.9,
                (this.resizeState.startSizeA + delta) / total
            ));

            elA.style.flex = `0 0 ${newRatio * 100}%`;
            elB.style.flex = `0 0 ${(1 - newRatio) * 100}%`;

            console.log('[obsidian-flow] Divider resize', { idx, newRatio: newRatio.toFixed(2) });
        });

        this.containerEl.addEventListener('mouseup', () => {
            if (this.resizeState.active) {
                this.resizeState.active = false;
                this.containerEl.style.cursor = '';
                this.containerEl.style.userSelect = '';
                console.log('[obsidian-flow] Divider resize ended');
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.resizeState.active) {
                this.resizeState.active = false;
                this.containerEl.style.cursor = '';
                this.containerEl.style.userSelect = '';
            }
        }, { once: false });
    }

    addDivider(afterIndex: number) {
        if (this.dividerEls.length === 0) {
            this.initResizeController();
        }

        const divider = document.createElement('div');
        divider.addClass('obsidian-flow-split-divider');
        divider.style.flexShrink = '0';
        divider.style.position = 'relative';
        divider.style.zIndex = '5';
        divider.style.backgroundColor = 'var(--background-modifier-border)';

        if (this.direction === 'horizontal') {
            divider.style.width = '5px';
            divider.style.height = '100%';
            divider.style.cursor = 'col-resize';
        } else {
            divider.style.height = '5px';
            divider.style.width = '100%';
            divider.style.cursor = 'row-resize';
        }

        const grip = divider.createDiv('obsidian-flow-divider-grip');
        grip.style.position = 'absolute';
        grip.style.top = '50%';
        grip.style.left = '50%';
        grip.style.transform = 'translate(-50%, -50%)';
        grip.style.opacity = '0';
        grip.style.transition = 'opacity 0.15s';
        grip.innerText = this.direction === 'horizontal' ? '⋮' : '⋯';
        grip.style.fontSize = '14px';
        grip.style.color = 'var(--text-muted)';
        grip.style.pointerEvents = 'none';
        divider.addEventListener('mouseenter', () => { grip.style.opacity = '1'; });
        divider.addEventListener('mouseleave', () => { grip.style.opacity = '0'; });

        divider.addEventListener('mousedown', (e) => {
            if (this.mode !== 'design') {
                console.log('[obsidian-flow] Divider resize blocked in use mode');
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const childA = this.children[afterIndex];
            const childB = this.children[afterIndex + 1];
            if (!childA || !childB) return;

            const sizeA = this.direction === 'horizontal'
                ? childA.containerEl.offsetWidth
                : childA.containerEl.offsetHeight;
            const sizeB = this.direction === 'horizontal'
                ? childB.containerEl.offsetWidth
                : childB.containerEl.offsetHeight;

            this.resizeState = {
                active: true,
                dividerIndex: afterIndex,
                startPos: this.direction === 'horizontal' ? e.clientX : e.clientY,
                startSizeA: sizeA,
                startSizeB: sizeB,
                totalSize: sizeA + sizeB,
            };

            this.containerEl.style.cursor = this.direction === 'horizontal' ? 'col-resize' : 'row-resize';
            this.containerEl.style.userSelect = 'none';
            console.log('[obsidian-flow] Divider resize started', { afterIndex, sizeA, sizeB });
        });

        this.dividerEls.push(divider);

        const nextChild = this.children[afterIndex + 1];
        if (nextChild) {
            this.containerEl.insertBefore(divider, nextChild.containerEl);
        } else {
            this.containerEl.appendChild(divider);
        }
    }
}
