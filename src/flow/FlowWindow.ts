import { App, Component, Modal, Setting } from "obsidian";
import { FlowTabs } from "./FlowTabs";
import { FlowViewPicker } from "./FlowViewPicker";
import { FlowDragController } from "./FlowDragController";
import type ObsidianFlowPlugin from "../main";
import { FlowSplit } from "./FlowSplit";

export interface FlowWindowState {
    x: number;
    y: number;
    width: number;
    height: number;
    minimised: boolean;
    maximised: boolean;
    activeContextId: string | null;
}

export class FlowWindow extends Component {
    app: App;
    plugin: ObsidianFlowPlugin;
    containerEl: HTMLElement;
    titleBarEl: HTMLElement;
    contentEl: HTMLElement;

    state: FlowWindowState = {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        minimised: false,
        maximised: false,
        activeContextId: null
    };

    rootSplit: FlowSplit;
    rootTabs: FlowTabs; // Maintained reference for simple serialization
    dragController: FlowDragController;

    constructor(app: App, plugin: ObsidianFlowPlugin) {
        super();
        this.app = app;
        this.plugin = plugin;
        console.log("[obsidian-flow] FlowWindow created");
        this.buildUI();

        this.dragController = new FlowDragController(this.app, this, plugin);
        this.dragController.setupDropZone();
    }

    buildUI() {
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('obsidian-flow-window');
        this.containerEl.style.position = 'absolute';
        this.containerEl.style.zIndex = 'var(--layer-popover)';
        this.containerEl.style.backgroundColor = 'var(--background-primary)';
        this.containerEl.style.border = '1px solid var(--background-modifier-border)';
        this.containerEl.style.boxShadow = 'var(--shadow-l)';
        this.containerEl.style.borderRadius = 'var(--radius-l)';
        this.containerEl.style.display = 'flex';
        this.containerEl.style.flexDirection = 'column';
        this.containerEl.style.overflow = 'hidden';

        this.applyStateBounds();

        this.titleBarEl = this.containerEl.createDiv('obsidian-flow-titlebar');
        this.titleBarEl.style.display = 'flex';
        this.titleBarEl.style.alignItems = 'center';
        this.titleBarEl.style.padding = '8px 12px';
        this.titleBarEl.style.borderBottom = '1px solid var(--background-modifier-border)';
        this.titleBarEl.style.backgroundColor = 'var(--background-secondary)';
        this.titleBarEl.style.cursor = 'move';
        this.titleBarEl.style.userSelect = 'none';

        const titleText = this.titleBarEl.createDiv('obsidian-flow-title');
        titleText.innerText = "ObsidianFlow";
        titleText.style.flexGrow = '1';
        titleText.style.fontWeight = 'bold';

        // Controls
        const controls = this.titleBarEl.createDiv('obsidian-flow-controls');
        controls.style.display = 'flex';
        controls.style.gap = '8px';

        const addTabBtn = controls.createEl('button', { text: '+' });
        addTabBtn.onclick = () => this.createNewTab();

        const saveBtn = controls.createEl('button', { text: 'Save' });
        saveBtn.onclick = () => this.saveContext();

        const minBtn = controls.createEl('button', { text: '-' });
        minBtn.onclick = () => this.toggleMinimise();

        const maxBtn = controls.createEl('button', { text: '[]' });
        maxBtn.onclick = () => this.toggleMaximise();

        const closeBtn = controls.createEl('button', { text: 'x' });
        closeBtn.onclick = () => this.hide();

        this.contentEl = this.containerEl.createDiv('obsidian-flow-content');
        this.contentEl.style.flexGrow = '1';
        this.contentEl.style.position = 'relative';
        this.contentEl.style.display = 'flex';
        this.contentEl.style.flexDirection = 'column';

        // Initialize root split container
        this.rootSplit = new FlowSplit(this.app, this.plugin, this.contentEl, "horizontal");
        this.rootSplit.plugin = this.plugin;

        const tabsContainer = document.createElement('div');
        tabsContainer.style.flexGrow = '1';
        tabsContainer.style.display = 'flex';
        tabsContainer.style.flexDirection = 'column';
        this.rootTabs = new FlowTabs(this.app, this.plugin, tabsContainer);

        this.rootSplit.addTabs(this.rootTabs);

        this.setupDragging();
        this.setupResizing();
    }

    applyStateBounds() {
        if (this.state.maximised) {
            this.containerEl.style.left = '0';
            this.containerEl.style.top = '0';
            this.containerEl.style.width = '100vw';
            this.containerEl.style.height = '100vh';
        } else if (this.state.minimised) {
            this.containerEl.style.left = `${this.state.x}px`;
            this.containerEl.style.top = `${this.state.y}px`;
            this.containerEl.style.width = `${this.state.width}px`;
            this.containerEl.style.height = 'auto';
        } else {
            this.containerEl.style.left = `${this.state.x}px`;
            this.containerEl.style.top = `${this.state.y}px`;
            this.containerEl.style.width = `${this.state.width}px`;
            this.containerEl.style.height = `${this.state.height}px`;
        }
    }

    toggleMinimise() {
        this.state.minimised = !this.state.minimised;
        if (this.state.minimised) {
            this.state.maximised = false;
            this.contentEl.style.display = 'none';
        } else {
            this.contentEl.style.display = 'flex';
        }
        this.applyStateBounds();
    }

    toggleMaximise() {
        this.state.maximised = !this.state.maximised;
        if (this.state.maximised) {
            this.state.minimised = false;
            this.contentEl.style.display = 'flex';
        }
        this.applyStateBounds();
    }

    setupDragging() {
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        this.titleBarEl.addEventListener('mousedown', (e) => {
            if (e.target instanceof HTMLButtonElement) return;
            if (this.state.maximised) return;

            isDragging = true;
            startX = e.clientX - this.state.x;
            startY = e.clientY - this.state.y;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            this.state.x = e.clientX - startX;
            this.state.y = e.clientY - startY;
            this.applyStateBounds();
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    setupResizing() {
        const resizeHandle = this.containerEl.createDiv('obsidian-flow-resize-handle');
        resizeHandle.style.position = 'absolute';
        resizeHandle.style.bottom = '0';
        resizeHandle.style.right = '0';
        resizeHandle.style.width = '10px';
        resizeHandle.style.height = '10px';
        resizeHandle.style.cursor = 'se-resize';

        let isResizing = false;
        let startWidth = 0;
        let startHeight = 0;
        let startX = 0;
        let startY = 0;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (this.state.maximised || this.state.minimised) return;
            isResizing = true;
            startWidth = this.state.width;
            startHeight = this.state.height;
            startX = e.clientX;
            startY = e.clientY;
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            this.state.width = Math.max(200, startWidth + (e.clientX - startX));
            this.state.height = Math.max(100, startHeight + (e.clientY - startY));
            this.applyStateBounds();
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });
    }

    createNewTab() {
        new FlowViewPicker(this.app, this).open();
    }

    saveContext() {
        const modal = new SaveContextModal(this.app, this.plugin.settings.flowContexts.map(c => c.name), (name, overwrite) => {
            void this.plugin.serializer.serializeContext(this, name, overwrite);
        });
        modal.open();
    }

    show() {
        if (!this.containerEl.parentNode) {
            document.body.appendChild(this.containerEl);
        } else {
            this.containerEl.style.display = 'flex';
        }
    }

    hide() {
        if (this.containerEl.parentNode) {
            this.containerEl.style.display = 'none';
        }
    }

    onunload() {
        if (this.containerEl.parentNode) {
            this.containerEl.parentNode.removeChild(this.containerEl);
        }
    }
}

class SaveContextModal extends Modal {
    onSubmit: (name: string, overwrite: boolean) => void;
    existingNames: string[];
    name: string = "";

    constructor(app: App, existingNames: string[], onSubmit: (name: string, overwrite: boolean) => void) {
        super(app);
        this.existingNames = existingNames;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h1", { text: "Save Flow Context" });

        new Setting(contentEl)
            .setName("Context Name")
            .addText((text) =>
                text.onChange((value) => {
                    this.name = value;
                })
            );

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Save")
                .setCta()
                .onClick(() => {
                    if (this.existingNames.includes(this.name)) {
                        this.close();
                        const confirmModal = new ConfirmOverwriteModal(this.app, this.name, () => {
                            this.onSubmit(this.name, true);
                        });
                        confirmModal.open();
                    } else {
                        this.close();
                        this.onSubmit(this.name, false);
                    }
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ConfirmOverwriteModal extends Modal {
    nameToOverwrite: string;
    onConfirm: () => void;

    constructor(app: App, name: string, onConfirm: () => void) {
        super(app);
        this.nameToOverwrite = name;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: `Overwrite "${this.nameToOverwrite}"?` });
        contentEl.createEl("p", { text: "A context with this name already exists. Do you want to overwrite it?" });

        const controls = contentEl.createDiv();
        controls.style.display = 'flex';
        controls.style.gap = '8px';
        controls.style.justifyContent = 'flex-end';

        const cancelBtn = controls.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();

        const okBtn = controls.createEl('button', { text: 'Overwrite' });
        okBtn.addClass('mod-warning');
        okBtn.onclick = () => {
            this.close();
            this.onConfirm();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}
