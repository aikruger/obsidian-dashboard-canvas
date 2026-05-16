import { App, WorkspaceLeaf } from "obsidian";
import { FlowContext, FlowLeafState, FlowSplitState } from "./FlowContext";
import { FlowWindow } from "./FlowWindow";
import { getParentRemover, getLeafId } from "./FlowUtils";
import ObsidianFlowPlugin from "../main";
import { FlowSplit } from "./FlowSplit";
import { FlowTabs } from "./FlowTabs";

export class FlowSerializer {
    plugin: ObsidianFlowPlugin;
    app: App;

    constructor(plugin: ObsidianFlowPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    async serializeContext(window: FlowWindow, name: string, overwrite: boolean = false): Promise<FlowContext> {
        console.log("[obsidian-flow] Serialiser: starting serialise pass", name);

        const existingContext = this.plugin.settings.flowContexts.find(c => c.name === name);

        const context: FlowContext = {
            id: existingContext && overwrite ? existingContext.id : 'ctx-' + Date.now().toString(),
            name,
            createdAt: existingContext && overwrite ? existingContext.createdAt : Date.now(),
            updatedAt: Date.now(),
            windowBounds: {
                x: window.state.x,
                y: window.state.y,
                width: window.state.width,
                height: window.state.height
            },
            layout: this.serializeSplit(window.rootSplit),
            activeLeafId: window.rootTabs.activeLeaf ? getLeafId(window.rootTabs.activeLeaf) : ''
        };

        if (existingContext && overwrite) {
            const index = this.plugin.settings.flowContexts.findIndex(c => c.id === existingContext.id);
            if (index !== -1) {
                this.plugin.settings.flowContexts[index] = context;
            }
        } else {
            this.plugin.settings.flowContexts.push(context);
            this.plugin.commandManager.registerCommand(context);
        }

        await this.plugin.saveSettings();

        console.log("[obsidian-flow] Context serialised", name);
        return context;
    }

    serializeSplit(split: FlowSplit): FlowSplitState {
        return {
            direction: split.direction,
            ratio: 1, // Simplified for now
            children: split.children.map(child => {
                if (child instanceof FlowSplit) {
                    return this.serializeSplit(child);
                } else {
                    return this.serializeTabs(child);
                }
            })
        };
    }

    serializeTabs(tabs: FlowTabs): FlowLeafState {
        // We only serialize the active leaf or the first one for simplicity,
        // or potentially we should alter the FlowLeafState to support multiple leaves per tab.
        // For the sake of the specification let's serialize the first leaf or empty state.
        const leaf = tabs.leaves[0];
        if (leaf) {
            return this.serializeLeaf(leaf);
        }
        return {
            id: 'tabs-' + Date.now().toString(),
            type: 'empty',
            state: {},
            eState: undefined
        };
    }

    serializeLeaf(leaf: WorkspaceLeaf): FlowLeafState {
        const type = leaf.view?.getViewType() || 'empty';
        const state = leaf.view?.getState() || {};
        const eState = leaf.view?.getEphemeralState ? leaf.view.getEphemeralState() : {};

        const leafId = getLeafId(leaf);
        console.log("[obsidian-flow] Serialiser: leaf captured", { id: leafId, type });

        return {
            id: leafId,
            type,
            state: state,
            eState: eState ? eState : undefined
        };
    }

    async restoreContext(window: FlowWindow, contextId: string) {
        const context = this.plugin.settings.flowContexts.find(c => c.id === contextId);
        if (!context) {
            console.error("[obsidian-flow] Context not found", contextId);
            return;
        }

        console.log("[obsidian-flow] Serialiser: starting restore pass", context.name);

        window.state.x = context.windowBounds.x;
        window.state.y = context.windowBounds.y;
        window.state.width = context.windowBounds.width;
        window.state.height = context.windowBounds.height;
        window.applyStateBounds();

        // Clear everything
        window.contentEl.empty();

        // Rebuild root split
        window.rootSplit = new FlowSplit(this.app, this.plugin, window.contentEl, 'horizontal');

        // Since we re-initialized rootSplit, we need to bind the drop events and populate it
        window.dragController.setupDropZone(); // Not strictly needed to re-run, but we need to re-wire onDrop at least

        window.rootSplit.onDrop = (targetTabs, mode) => {
            if (!this.plugin.currentDragSession) return;
            console.log('[obsidian-flow] Edge drop routed to FlowSplit.splitAt', { mode });
            window.rootSplit.hideAllDropZones();

            const session = this.plugin.currentDragSession;
            if (!session) return;

            const newTabs = window.rootSplit.splitAt(targetTabs, mode);
            void window.dragController.applySessionToTabs(session, newTabs);
        };

        if (context.layout) {
             await this.restoreSplit(window.rootSplit, context.layout as FlowSplitState);
        }

        window.show();
    }

    async restoreSplit(parentSplit: FlowSplit, state: FlowSplitState) {
        parentSplit.direction = state.direction || 'horizontal';

        if (state.children) {
            let first = true;
            for (const childState of state.children) {
                if (!first) {
                    parentSplit.addDivider(parentSplit.children.length - 1);
                }

                if ('direction' in childState) {
                    const wrapperEl = document.createElement('div');
                    wrapperEl.style.flex = '1 1 0%';
                    wrapperEl.style.display = 'flex';
                    wrapperEl.style.width = '100%';
                    wrapperEl.style.height = '100%';
                    const newSplit = new FlowSplit(this.app, this.plugin, wrapperEl, (childState).direction);
                    newSplit.onDrop = parentSplit.onDrop;
                    parentSplit.addSplit(newSplit);

                    await this.restoreSplit(newSplit, childState);
                } else {
                    const tabsEl = document.createElement('div');
                    tabsEl.style.flex = '1 1 0%';
                    tabsEl.style.display = 'flex';
                    tabsEl.style.flexDirection = 'column';
                    const newTabs = new FlowTabs(this.app, this.plugin, tabsEl);
                    parentSplit.addTabs(newTabs);

                    if (childState.type !== 'empty') {
                        await this.restoreLeafIntoTabs(newTabs, childState);
                    }
                }

                first = false;
            }
        }
    }

    async restoreLeafIntoTabs(tabs: FlowTabs, leafState: FlowLeafState) {
        try {
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: leafState.type,
                state: leafState.state
            });

            if (leafState.eState && leaf.view.setEphemeralState) {
                leaf.view.setEphemeralState(leafState.eState);
            }

            const p = getParentRemover(leaf);
            if (p) {
                p.removeChild(leaf);
            }

            tabs.addLeaf(leaf);
            console.log("[obsidian-flow] Serialiser: leaf restored", { id: leafState.id, type: leafState.type });
        } catch (error) {
            console.error("[obsidian-flow] Serialiser: restore failed for leaf", { id: leafState.id, error });
        }
    }
}
