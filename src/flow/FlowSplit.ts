import { App, Component } from "obsidian";
import { FlowTabs } from "./FlowTabs";

export class FlowSplit extends Component {
    app: App;
    containerEl: HTMLElement;
    direction: 'horizontal' | 'vertical';
    children: (FlowSplit | FlowTabs)[];

    constructor(app: App, containerEl: HTMLElement, direction: 'horizontal' | 'vertical' = 'horizontal') {
        super();
        this.app = app;
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

        // Add drop zones for splits at edges
        this.createDropZones();
    }

    createDropZones() {
        // Implement edge zones to capture drop and split
        const edges = ['top', 'bottom', 'left', 'right'];
        for (const edge of edges) {
            const dropZone = this.containerEl.createDiv('obsidian-flow-dropzone-' + edge);
            dropZone.style.position = 'absolute';
            dropZone.style.display = 'none';
            dropZone.style.backgroundColor = 'var(--interactive-accent)';
            dropZone.style.opacity = '0.3';
            dropZone.style.zIndex = 'var(--layer-popover)';

            // Positioning sizes
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
                e.preventDefault();
                dropZone.style.opacity = '0.6';
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.style.opacity = '0.3';
            });
            // Let the main window's drop listener handle the split logic, or we can catch it here if we pass the controller
        }
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
}
