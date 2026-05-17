import { App, Notice, WorkspaceLeaf } from "obsidian";
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
        this.setupNativeDragCapture();
    }

    setupNativeDragCapture() {
        document.addEventListener('dragstart', (e) => {
            if (this.plugin.currentDragSession) return;

            const dragTarget = e.target as HTMLElement | null;
            if (!dragTarget) return;

            let leaf: WorkspaceLeaf | null = null;

            const leafContainer = dragTarget.closest('.workspace-leaf');
            if (leafContainer) {
                this.app.workspace.iterateAllLeaves((l) => {
                    const lAny = l as unknown as { containerEl?: HTMLElement };
                    if (lAny.containerEl === leafContainer) leaf = l;
                });
            }

            if (!leaf) {
                const tabHeader = dragTarget.closest('.workspace-tab-header');
                if (tabHeader) {
                    this.app.workspace.iterateAllLeaves((l) => {
                        const lAny = l as unknown as { tabHeaderEl?: HTMLElement };
                        if (lAny.tabHeaderEl === tabHeader) leaf = l;
                    });
                }
            }

            if (!leaf) {
                console.log('[obsidian-flow] setupNativeDragCapture: no leaf found for dragstart target');
                return;
            }

            const resolvedLeaf = leaf as WorkspaceLeaf;
            const leafView = resolvedLeaf.view;
            if (!leafView) return;

            this.plugin.currentDragSession = {
                leaf: resolvedLeaf,
                type: leafView.getViewType(),
                state: leafView.getState ? leafView.getState() : {},
                eState: leafView.getEphemeralState ? leafView.getEphemeralState() : null,
                sourceInternal: false,
                sourceLeaf: resolvedLeaf,
                sourceTabs: null
            };

            console.log('[obsidian-flow] setupNativeDragCapture: session created from native drag', this.plugin.currentDragSession.type);
        }, true);

        document.addEventListener('dragend', () => {
            if (this.plugin.currentDragSession && !this.plugin.currentDragSession.sourceInternal) {
                this.plugin.currentDragSession = null;
                console.log('[obsidian-flow] setupNativeDragCapture: native drag session cleared on dragend');
            }
        }, true);
    }

    findTabsUnderPoint(x: number, y: number): FlowTabs | null {
        const allTabs = this.flowWindow.collectAllTabs(this.flowWindow.rootSplit);
        for (const tabs of allTabs) {
            const rect = tabs.leavesEl.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                console.log('[obsidian-flow] findTabsUnderPoint: found tabs at', { x, y });
                return tabs;
            }
        }
        console.log('[obsidian-flow] findTabsUnderPoint: no tabs found at', { x, y });
        return null;
    }

    setupDropZone() {
        const container = this.flowWindow.contentEl;

        container.addEventListener('dragover', (e) => {
            if (!this.plugin.currentDragSession) return;
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
        });

        container.addEventListener('dragenter', () => {
            if (!this.plugin.currentDragSession) {
                console.log('[obsidian-flow] dragenter: no session yet, checking native drag');
                setTimeout(() => {
                    if (this.plugin.currentDragSession) {
                        console.log('[obsidian-flow] dragenter (deferred): session now available, showing zones');
                        this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                            .forEach(tabs => tabs.showDropZones());
                    }
                }, 0);
                return;
            }
            console.log('[obsidian-flow] dragenter: session active, showing drop zones. mode:', this.flowWindow.state.mode);
            this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                .forEach(tabs => tabs.showDropZones());
        });

        container.addEventListener('dragleave', (e) => {
            container.style.border = 'none';
            if (!container.contains(e.relatedTarget as Node)) {
                this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                    .forEach(tabs => tabs.hideDropZones());
                console.log('[obsidian-flow] dragleave: left container, hiding all drop zones');
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            container.style.border = 'none';
            this.flowWindow.collectAllTabs(this.flowWindow.rootSplit)
                .forEach(tabs => tabs.hideDropZones());

            if (!this.plugin.currentDragSession) {
                console.log('[obsidian-flow] drop: no active session, skipping');
                return;
            }


            const target = this.findTabsUnderPoint(e.clientX, e.clientY) ?? this.flowWindow.rootTabs;

            console.log('[obsidian-flow] drop: routing to tabs', target);
            void this.applyDropSession(e, target);

            this.plugin.currentDragSession = null;
            console.log('[obsidian-flow] drop: session cleared after successful drop');
        });
    }

    wireTabs(tabs: FlowTabs) {
        tabs.onSplitDrop = (targetTabs, mode) => {
            if (!this.plugin.currentDragSession) return;

            if (this.flowWindow.state.mode === 'use') {
                console.log('[obsidian-flow] onSplitDrop in use mode: redirecting edge drop to tab add (no new splits)');
                void this.applySessionToTabs(this.plugin.currentDragSession, targetTabs);
            } else {
                console.log('[obsidian-flow] onSplitDrop in design mode: creating split', mode);
                const newTabs = this.flowWindow.rootSplit.splitAt(targetTabs, mode);
                this.wireTabs(newTabs);
                void this.applySessionToTabs(this.plugin.currentDragSession, newTabs);
            }
            this.plugin.currentDragSession = null;
        };

        tabs.onTabDrop = (targetTabs) => {
            if (!this.plugin.currentDragSession) return;
            console.log('[obsidian-flow] onTabDrop fired, mode:', this.flowWindow.state.mode);
            void this.applySessionToTabs(this.plugin.currentDragSession, targetTabs);
            this.plugin.currentDragSession = null;
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
