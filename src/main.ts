import { Plugin, WorkspaceLeaf } from 'obsidian';
import { FlowWindow } from './flow/FlowWindow';
import { DEFAULT_SETTINGS, ObsidianFlowSettings } from './flow/FlowContext';
import { FlowSerializer } from './flow/FlowSerializer';
import { FlowCommandManager } from './flow/FlowCommandManager';
import { FlowSettingsTab } from './flow/FlowSettingsTab';
import { FlowDragSession } from './flow/FlowUtils';

export default class ObsidianFlowPlugin extends Plugin {
    settings: ObsidianFlowSettings;
    flowWindow: FlowWindow;
    serializer: FlowSerializer;
    commandManager: FlowCommandManager;

    currentDragSession: FlowDragSession | null = null;
    lastDragEvent: DragEvent | null = null;
    leafMap: WeakMap<HTMLElement, WorkspaceLeaf> = new WeakMap();

    async onload() {
        console.log("Loading ObsidianFlow Plugin");

        await this.loadSettings();

        this.flowWindow = new FlowWindow(this.app, this);
        this.serializer = new FlowSerializer(this);
        this.commandManager = new FlowCommandManager(this);

        this.commandManager.registerCommandsForContexts();

        this.addSettingTab(new FlowSettingsTab(this.app, this));

        this.addRibbonIcon('layout-dashboard', 'ObsidianFlow', () => {
            if (this.flowWindow.containerEl.parentNode && this.flowWindow.containerEl.style.display !== 'none') {
                this.flowWindow.hide();
            } else {
                this.flowWindow.show();
            }
        });

        this.addCommand({
            id: 'toggle-flow-window',
            name: 'Toggle Flow Window',
            callback: () => {
                if (this.flowWindow.containerEl.parentNode && this.flowWindow.containerEl.style.display !== 'none') {
                    this.flowWindow.hide();
                } else {
                    this.flowWindow.show();
                }
            }
        });

        this.app.workspace.onLayoutReady(() => {
            this.buildLeafMap();

            this.registerEvent(this.app.workspace.on('layout-change', () => {
                this.buildLeafMap();
            }));

            this.registerDomEvent(document, 'dragstart', (e: DragEvent) => {
                const target = e.target as HTMLElement | null;
                if (!target) return;

                const isWorkspaceTabHeader = !!target.closest('.workspace-tab-header');
                const isFlowTabHeader = !!target.closest('.obsidian-flow-tab');

                if (!isWorkspaceTabHeader && !isFlowTabHeader) {
                    console.log('[obsidian-flow] dragstart ignored: not a tab header drag', target.className);
                    this.currentDragSession = null;
                    return;
                }

                console.log('[obsidian-flow] dragstart detected on tab header', {
                    workspace: isWorkspaceTabHeader,
                    flow: isFlowTabHeader,
                    target: target.className,
                });

                this.lastDragEvent = e;

                const tabHeader = isWorkspaceTabHeader ? target.closest('.workspace-tab-header') as HTMLElement : target.closest('.obsidian-flow-tab') as HTMLElement;
                if (tabHeader && isWorkspaceTabHeader) {
                    const leaf = this.leafMap.get(tabHeader);
                    if (leaf && leaf.view) {
                        this.currentDragSession = {
                            leaf,
                            type: leaf.view.getViewType(),
                            state: leaf.view.getState(),
                            eState: leaf.view.getEphemeralState ? leaf.view.getEphemeralState() : null
                        };
                        console.log("[obsidian-flow] Drag started from main workspace leaf", this.currentDragSession.type);
                    } else {
                        this.currentDragSession = null;
                        console.warn('[obsidian-flow] dragstart: could not resolve leaf from tab header');
                    }
                }
            });

            this.registerDomEvent(document, 'dragend', () => {
                if (this.currentDragSession) {
                    console.log('[obsidian-flow] dragend: clearing session');
                    this.currentDragSession = null;
                }
                this.lastDragEvent = null;
            });

            if (this.settings.openOnStartup) {
                let contextToRestore = this.settings.defaultContextId;
                if (this.settings.rememberLastContext && this.settings.flowContexts && this.settings.flowContexts.length > 0) {
                    const sorted = [...this.settings.flowContexts].sort((a, b) => b.updatedAt - a.updatedAt);
                    const first = sorted[0];
                    if (first) {
                        contextToRestore = first.id;
                    }
                }

                if (contextToRestore) {
                    void this.serializer.restoreContext(this.flowWindow, contextToRestore);
                }
            }
        });
    }

    buildLeafMap() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            const leafAny = leaf as unknown as { tabHeaderEl: HTMLElement };
            if (leafAny.tabHeaderEl) {
                this.leafMap.set(leafAny.tabHeaderEl, leaf);
            }
        });
    }

    onunload() {
        console.log("Unloading ObsidianFlow Plugin");
        if (this.flowWindow) {
            this.flowWindow.unload();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ObsidianFlowSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
