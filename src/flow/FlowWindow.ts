import { App, Component, Modal, Setting, Notice } from "obsidian";
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
    mode: 'design' | 'use';
}

export class FlowWindow extends Component {
    app: App;
    plugin: ObsidianFlowPlugin;
    containerEl: HTMLElement;
    titleBarEl: HTMLElement;
    contentEl: HTMLElement;

    modeIndicatorEl: HTMLElement;
    modeToggleBtn: HTMLButtonElement;

    state: FlowWindowState = {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        minimised: false,
        maximised: false,
        activeContextId: null,
        mode: 'design'
    };

    rootSplit: FlowSplit;
    rootTabs: FlowTabs; // Maintained reference for serialization shortcut
    dragController: FlowDragController;

    constructor(app: App, plugin: ObsidianFlowPlugin) {
        super();
        this.app = app;
        this.plugin = plugin;
        console.log("[obsidian-flow] FlowWindow created");
        this.buildUI();

        this.dragController = new FlowDragController(this.app, this, plugin);
        this.dragController.setupDropZone();
        this.dragController.wireTabs(this.rootTabs);
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
        controls.style.alignItems = 'center';

        const modeIndicator = controls.createDiv('obsidian-flow-mode-indicator');
        modeIndicator.style.fontSize = '11px';
        modeIndicator.style.padding = '2px 8px';
        modeIndicator.style.borderRadius = '4px';
        modeIndicator.style.marginRight = '8px';
        modeIndicator.style.fontWeight = 'bold';
        modeIndicator.style.letterSpacing = '0.05em';
        modeIndicator.style.textTransform = 'uppercase';
        this.modeIndicatorEl = modeIndicator;

        const modeToggleBtn = controls.createEl('button');
        modeToggleBtn.setAttribute('aria-label', 'Toggle design / use mode');
        this.modeToggleBtn = modeToggleBtn;
        modeToggleBtn.onclick = () => this.toggleMode();

        const addTabBtn = controls.createEl('button', { text: '+' });
        addTabBtn.addClass('obsidian-flow-add-btn');
        addTabBtn.onclick = () => {
            if (this.state.mode !== 'design') {
                console.log('[obsidian-flow] Add pane blocked — not in design mode');
                new Notice('Switch to Design mode to add panes.');
                return;
            }
            const newTabs = this.rootSplit.splitAt(this.rootTabs, 'split-right');
            this.dragController.wireTabs(newTabs);
            this.rootSplit.addDivider(this.rootSplit.children.indexOf(newTabs) - 1);
            console.log('[obsidian-flow] New pane added in design mode');
        };

        const saveBtn = controls.createEl('button', { text: 'Save' });
        saveBtn.onclick = () => this.saveContext();

        const clearBtn = controls.createEl('button', { text: 'Clear' });
        clearBtn.setAttribute('aria-label', 'Clear all tabs from current view');
        clearBtn.onclick = () => {
            console.log('[obsidian-flow] Clear button clicked');
            this.rootTabs.clearAll();
        };

        const resetBtn = controls.createEl('button', { text: 'Reset' });
        resetBtn.setAttribute('aria-label', 'Reset entire window to empty state');
        resetBtn.onclick = () => {
            console.log('[obsidian-flow] Reset button clicked');
            const confirmed = confirm('Reset ObsidianFlow? This will remove all tabs and splits.');
            if (confirmed) {
                this.resetWindow();
            }
        };

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
        this.rootSplit = new FlowSplit(this.app, this.plugin, this.contentEl, 'horizontal');

        const tabsContainer = document.createElement('div');
        tabsContainer.style.flexGrow = '1';
        tabsContainer.style.display = 'flex';
        tabsContainer.style.flexDirection = 'column';
        this.rootTabs = new FlowTabs(this.app, this.plugin, tabsContainer);

        this.rootSplit.addTabs(this.rootTabs);

        this.setupDragging();
        this.setupResizing();

        this.applyMode();
    }

    applyMode() {
        const isDesign = this.state.mode === 'design';
        console.log('[obsidian-flow] FlowWindow.applyMode', this.state.mode);

        this.modeIndicatorEl.innerText = isDesign ? '✏ Design' : '▶ Use';
        this.modeIndicatorEl.style.backgroundColor = isDesign
            ? 'var(--color-yellow, #d19900)'
            : 'var(--color-green, #437a22)';
        this.modeIndicatorEl.style.color = 'var(--text-on-accent, white)';

        this.modeToggleBtn.innerText = isDesign ? 'Lock Layout' : 'Edit Layout';

        this.collectAllTabs(this.rootSplit).forEach(tabs => tabs.setMode(this.state.mode));
        this.collectAllSplits(this.rootSplit).forEach(split => split.setMode(this.state.mode));

        const addTabBtn = this.titleBarEl.querySelector('.obsidian-flow-add-btn');
        if (addTabBtn) {
            const btn = addTabBtn as HTMLElement;
            btn.style.display = isDesign ? 'block' : 'none';
        }
    }

    toggleMode() {
        this.state.mode = this.state.mode === 'design' ? 'use' : 'design';
        console.log('[obsidian-flow] FlowWindow.toggleMode:', this.state.mode);
        this.applyMode();
    }

    collectAllSplits(split: FlowSplit): FlowSplit[] {
        const result: FlowSplit[] = [split];
        for (const child of split.children) {
            if (child instanceof FlowSplit) {
                result.push(...this.collectAllSplits(child));
            }
        }
        return result;
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
            this.containerEl.style.height = 'auto'; // Let title bar dictate height
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
            void this.plugin.serializer.serializeContext(this, name, overwrite).then(() => {
                this.state.mode = 'use';
                this.applyMode();
                console.log('[obsidian-flow] Saved and locked to use mode', name);
            });
        });
        modal.open();
    }

    resetWindow() {
        console.log('[obsidian-flow] FlowWindow.resetWindow: clearing all content');

        // Recursively collect all FlowTabs and clear leaves
        this.collectAllTabs(this.rootSplit).forEach(tabs => {
            tabs.clearAll();
        });

        // Remove all children from rootSplit container
        while (this.contentEl.firstChild) {
            this.contentEl.removeChild(this.contentEl.firstChild);
            console.log('[obsidian-flow] FlowWindow.resetWindow: removed child from contentEl');
        }

        // Rebuild rootSplit fresh
        this.rootSplit = new FlowSplit(this.app, this.plugin, this.contentEl, 'horizontal');

        const tabsContainer = document.createElement('div');
        tabsContainer.style.flexGrow = '1';
        tabsContainer.style.display = 'flex';
        tabsContainer.style.flexDirection = 'column';
        this.rootTabs = new FlowTabs(this.app, this.plugin, tabsContainer);
        this.rootSplit.addTabs(this.rootTabs);

        // Re-wire the drag controller to the new rootSplit
        this.dragController.rewireRootSplit(this.rootSplit);
        this.dragController.wireTabs(this.rootTabs);

        // Clear active context
        this.state.activeContextId = null;
        this.updateTitleBar('ObsidianFlow');

        this.state.mode = 'design';
        this.applyMode();

        console.log('[obsidian-flow] FlowWindow.resetWindow: complete, fresh FlowTabs ready');
    }

    collectAllTabs(split: FlowSplit): FlowTabs[] {
        const result: FlowTabs[] = [];
        for (const child of split.children) {
            if (child instanceof FlowTabs) {
                result.push(child);
            } else if (child instanceof FlowSplit) {
                result.push(...this.collectAllTabs(child));
            }
        }
        return result;
    }

    updateTitleBar(name: string) {
        const titleEl = this.titleBarEl.querySelector('.obsidian-flow-title');
        if (titleEl) {
            const t = titleEl as HTMLElement;
            t.innerText = name;
        }
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
