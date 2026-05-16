import { App, WorkspaceLeaf } from "obsidian";
import { FlowContext, FlowLeafState } from "./FlowContext";
import { FlowWindow } from "./FlowWindow";
import { getParentRemover, getLeafId } from "./FlowUtils";
import ObsidianFlowPlugin from "../main";

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
            layout: {
                direction: 'horizontal',
                ratio: 1,
                // Flattening serialization for now, but leaving structure ready for recursive splits
                children: window.rootTabs.leaves.map(leaf => this.serializeLeaf(leaf))
            },
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

        window.rootTabs.leaves.forEach(l => l.detach());
        window.rootTabs.leaves = [];
        window.rootTabs.tabsEl.empty();
        window.rootTabs.leavesEl.empty();

        if ('children' in context.layout) {
            for (const child of context.layout.children) {
                if ('type' in child) {
                    await this.restoreLeaf(window, child);
                }
            }
        } else {
            await this.restoreLeaf(window, context.layout);
        }

        window.show();
    }

    async restoreLeaf(window: FlowWindow, leafState: FlowLeafState) {
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

            window.rootTabs.addLeaf(leaf);
            console.log("[obsidian-flow] Serialiser: leaf restored", { id: leafState.id, type: leafState.type });
        } catch (error) {
            console.error("[obsidian-flow] Serialiser: restore failed for leaf", { id: leafState.id, error });
        }
    }
}
