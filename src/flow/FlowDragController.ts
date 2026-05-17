import { App, Notice } from "obsidian";
import { FlowWindow } from "./FlowWindow";
import { resolveDraggedLeafFromEvent, getParentRemover, FlowDragSession } from "./FlowUtils";
import type ObsidianFlowPlugin from "../main";
import { FlowTabs } from "./FlowTabs";
import { FlowSplit } from "./FlowSplit";

export class FlowDragController {
    app: App;
    flowWindow: FlowWindow;
    plugin: ObsidianFlowPlugin;

    constructor(app: App, flowWindow: FlowWindow, plugin: ObsidianFlowPlugin) {
        this.app = app;
        this.flowWindow = flowWindow;
        this.plugin = plugin;
    }

    setupDropZone() {
        const container = this.flowWindow.contentEl;

        container.addEventListener('dragover', (e) => {
            if (!this.plugin.currentDragSession) return;
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            container.style.border = '2px dashed var(--interactive-accent)';
            console.log('[obsidian-flow] dragover: active session, showing drop indicator');
        });

        container.addEventListener('dragenter', () => {
            if (!this.plugin.currentDragSession) {
                console.log('[obsidian-flow] dragenter ignored: no session (internal plugin drag)');
                return;
            }
            const mode = this.flowWindow.state.mode;
            console.log('[obsidian-flow] dragenter, mode:', mode);

            if (mode === 'use') {
                this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                    .forEach(tabs => tabs.showDropZones());
            }
        });

        container.addEventListener('dragleave', (e) => {
            container.style.border = 'none';
            if (!container.contains(e.relatedTarget as Node)) {
                this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                    .forEach(tabs => tabs.hideDropZones());
                console.log('[obsidian-flow] dragleave: hiding all drop zones');
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            container.style.border = 'none';
            this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                .forEach(tabs => tabs.hideDropZones());

            if (!this.plugin.currentDragSession) {
                console.log('[obsidian-flow] drop ignored: no active session');
                return;
            }

            if (this.flowWindow.state.mode === 'design') {
                console.log('[obsidian-flow] drop in design mode: ignoring tab content drop on contentEl');
                return;
            }

            console.log('[obsidian-flow] Centre drop received in use mode');
            void this.applyDropSession(e, this.flowWindow.rootTabs);
        });

        this.flowWindow.rootSplit.onDrop = (targetTabs, mode) => {
            if (!this.plugin.currentDragSession) {
                console.log('[obsidian-flow] edge drop ignored: no active drag session');
                return;
            }

            console.log('[obsidian-flow] Edge drop routed to FlowSplit.splitAt', { mode });

            const session = resolveDraggedLeafFromEvent(
                this.plugin.lastDragEvent,
                this.plugin.currentDragSession
            );

            if (!session) {
                console.warn('[obsidian-flow] No drag session for edge drop');
                return;
            }

            const newTabs = this.flowWindow.rootSplit.splitAt(targetTabs, mode);
            void this.applySessionToTabs(session, newTabs);
        };
    }

    wireTabs(tabs: FlowTabs) {
        tabs.onSplitDrop = (targetTabs, mode) => {
            if (!this.plugin.currentDragSession) return;
            if (this.flowWindow.state.mode !== 'use') {
                console.log('[obsidian-flow] split drop blocked — not in use mode');
                return;
            }
            console.log('[obsidian-flow] onSplitDrop fired', mode);
            const newTabs = this.flowWindow.rootSplit.splitAt(targetTabs, mode);
            this.wireTabs(newTabs);
            void this.applySessionToTabs(this.plugin.currentDragSession, newTabs);
        };

        tabs.onTabDrop = (targetTabs) => {
            if (!this.plugin.currentDragSession) return;
            if (this.flowWindow.state.mode !== 'use') {
                console.log('[obsidian-flow] tab drop blocked — not in use mode');
                return;
            }
            console.log('[obsidian-flow] onTabDrop fired');
            void this.applySessionToTabs(this.plugin.currentDragSession, targetTabs);
        };

        console.log('[obsidian-flow] FlowDragController.wireTabs: wired', tabs);
    }

    rewireRootSplit(newRootSplit: FlowSplit) {
        console.log('[obsidian-flow] FlowDragController.rewireRootSplit: re-wiring to new root');

        newRootSplit.onDrop = (targetTabs, mode) => {
            if (!this.plugin.currentDragSession) {
                console.log('[obsidian-flow] edge drop ignored: no active drag session');
                return;
            }
            console.log('[obsidian-flow] Edge drop routed to FlowSplit.splitAt after reset', { mode });

            const session = resolveDraggedLeafFromEvent(
                this.plugin.lastDragEvent,
                this.plugin.currentDragSession
            );

            if (!session) {
                console.warn('[obsidian-flow] No drag session for edge drop after reset');
                return;
            }

            const newTabs = newRootSplit.splitAt(targetTabs, mode);
            void this.applySessionToTabs(session, newTabs);
        };

        console.log('[obsidian-flow] FlowDragController.rewireRootSplit: complete');
    }

    async applyDropSession(e: DragEvent, targetTabs: FlowTabs) {
        const session = resolveDraggedLeafFromEvent(e, this.plugin.currentDragSession);
        if (session) {
            await this.applySessionToTabs(session, targetTabs);
        } else {
            console.warn('[obsidian-flow] Drag source leaf had no readable state');
            new Notice('ObsidianFlow: Could not resolve exact dragged tab.');
        }
    }

    async applySessionToTabs(session: FlowDragSession, targetTabs: FlowTabs) {
        console.log('[obsidian-flow] Applying session to tabs', { viewType: session.type });
        try {
            const newLeaf = this.app.workspace.getLeaf('tab');
            await newLeaf.setViewState({ type: session.type, state: session.state });

            if (session.eState && newLeaf.view.setEphemeralState) {
                newLeaf.view.setEphemeralState(session.eState);
            }

            const p = getParentRemover(newLeaf);
            if (p) p.removeChild(newLeaf);

            targetTabs.addLeaf(newLeaf);
            console.log('[obsidian-flow] Tab added to target FlowTabs', { viewType: session.type });

            if (session.sourceInternal && session.sourceTabs && session.sourceTabs !== targetTabs && session.sourceLeaf) {
                session.sourceTabs.removeLeaf(session.sourceLeaf);
                console.log('[obsidian-flow] Internal tab moved between FlowTabs groups');
            }

        } catch (error) {
            console.error('[obsidian-flow] Failed to create copy of dropped leaf', error);
            new Notice('ObsidianFlow: Failed to duplicate tab.');
        }
    }
}
