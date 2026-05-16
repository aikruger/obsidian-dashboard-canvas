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

        this.createDropZones();
    }

    createDropZones() {
        const edges = ['top', 'bottom', 'left', 'right'];
        const modeMap: Record<string, DropMode> = {
            top: 'split-top',
            bottom: 'split-bottom',
            left: 'split-left',
            right: 'split-right',
        };

        for (const edge of edges) {
            const dropZone = this.containerEl.createDiv('obsidian-flow-dropzone-' + edge);
            dropZone.style.position = 'absolute';
            dropZone.style.display = 'none';
            dropZone.style.backgroundColor = 'var(--interactive-accent)';
            dropZone.style.opacity = '0.3';
            dropZone.style.zIndex = 'var(--layer-popover)';

            if (edge === 'top' || edge === 'bottom') {
                dropZone.style.width = '100%';
                dropZone.style.height = '30%';
                dropZone.style.left = '0';
                if (edge === 'top') dropZone.style.top = '0';
                else dropZone.style.bottom = '0';
            } else {
                dropZone.style.height = '100%';
                dropZone.style.width = '30%';
                dropZone.style.top = '0';
                if (edge === 'left') dropZone.style.left = '0';
                else dropZone.style.right = '0';
            }

            dropZone.addEventListener('dragover', (e) => {
                if (!this.plugin?.currentDragSession) return;
                e.preventDefault();
                dropZone.style.opacity = '0.6';
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.style.opacity = '0.3';
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation(); // prevent bubbling to contentEl global handler
                dropZone.style.opacity = '0.3';

                const currentMode = modeMap[edge];
                console.log('[obsidian-flow] FlowSplit edge drop received', { edge, mode: currentMode });
                if (this.onDrop && currentMode) {
                    const targetTabs = this.findTabsForDropZone();
                    if (targetTabs) {
                        this.onDrop(targetTabs, currentMode);
                    } else {
                        console.warn('[obsidian-flow] FlowSplit could not resolve target FlowTabs for edge drop', edge);
                    }
                }
            });

            console.log('[obsidian-flow] FlowSplit.createDropZones: wiring edge', edge);
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

    showDropZone(edge: string) {
        const query = this.containerEl.querySelector('.obsidian-flow-dropzone-' + edge) as HTMLElement;
        if (query) {
            query.style.display = 'block';
        }
    }

    hideDropZones() {
        const zones = this.containerEl.querySelectorAll('[class^="obsidian-flow-dropzone-"]');
        zones.forEach(z => {
            const zHtml = z as HTMLElement;
            zHtml.style.display = 'none';
        });
    }

    showAllDropZones() {
        ['top','bottom','left','right'].forEach(e => this.showDropZone(e));
        this.children.forEach(c => {
            if (c instanceof FlowSplit) c.showAllDropZones();
        });
    }

    hideAllDropZones() {
        this.hideDropZones();
        this.children.forEach(c => {
            if (c instanceof FlowSplit) c.hideAllDropZones();
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

    addDivider(afterIndex: number) {
        const divider = document.createElement('div');
        divider.addClass('obsidian-flow-split-divider');
        divider.style.flexShrink = '0';

        if (this.direction === 'horizontal') {
            divider.style.width = '4px';
            divider.style.cursor = 'col-resize';
            divider.style.height = '100%';
        } else {
            divider.style.height = '4px';
            divider.style.cursor = 'row-resize';
            divider.style.width = '100%';
        }
        divider.style.backgroundColor = 'var(--background-modifier-border)';
        divider.style.zIndex = '10';

        let dragging = false;
        let startPos = 0;

        divider.addEventListener('mousedown', (e) => {
            dragging = true;
            startPos = this.direction === 'horizontal' ? e.clientX : e.clientY;
            e.preventDefault();
            console.log('[obsidian-flow] Divider drag started');
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const currentPos = this.direction === 'horizontal' ? e.clientX : e.clientY;
            const delta = currentPos - startPos;
            startPos = currentPos;

            const childA = this.children[afterIndex];
            const childB = this.children[afterIndex + 1];

            if (childA && childB) {
                const elA = childA instanceof FlowTabs ? childA.containerEl : childA.containerEl;
                const elB = childB instanceof FlowTabs ? childB.containerEl : childB.containerEl;
                const sizeA = this.direction === 'horizontal' ? elA.offsetWidth : elA.offsetHeight;
                const sizeB = this.direction === 'horizontal' ? elB.offsetWidth : elB.offsetHeight;
                const totalSize = sizeA + sizeB;

                if (totalSize > 0) {
                    const newRatio = Math.max(0.1, Math.min(0.9, (sizeA + delta) / totalSize));
                    elA.style.flex = `0 0 ${newRatio * 100}%`;
                    elB.style.flex = `0 0 ${(1 - newRatio) * 100}%`;
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                console.log('[obsidian-flow] Divider drag ended');
            }
        });

        const nextChild = this.children[afterIndex + 1];
        if (nextChild) {
            this.containerEl.insertBefore(divider, nextChild.containerEl);
        } else {
            this.containerEl.appendChild(divider);
        }
    }
}
