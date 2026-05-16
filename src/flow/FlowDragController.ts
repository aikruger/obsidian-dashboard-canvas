import { App, Notice } from "obsidian";
import { FlowWindow } from "./FlowWindow";
import { resolveDraggedLeafFromEvent, getParentRemover } from "./FlowUtils";
import type ObsidianFlowPlugin from "../main";

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
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            container.style.border = '2px dashed var(--interactive-accent)';
        });

        container.addEventListener('dragleave', () => {
            container.style.border = 'none';
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            container.style.border = 'none';

            console.log("[obsidian-flow] Drop received in FlowWindow");

            const session = resolveDraggedLeafFromEvent(e, this.plugin.currentDragSession);

            if (session) {
                console.log("[obsidian-flow] Copying view state from active drag session", { viewType: session.type });

                const createDuplicate = async () => {
                    try {
                        const newLeaf = this.app.workspace.getLeaf('tab');
                        await newLeaf.setViewState({
                            type: session.type,
                            state: session.state
                        });

                        if (session.eState && newLeaf.view.setEphemeralState) {
                            newLeaf.view.setEphemeralState(session.eState);
                        }

                        const p = getParentRemover(newLeaf);
                        if (p) {
                            p.removeChild(newLeaf);
                        }
                        this.flowWindow.rootTabs.addLeaf(newLeaf);

                    } catch (error) {
                        console.error("[obsidian-flow] Failed to create copy of dropped leaf", error);
                        new Notice("ObsidianFlow: Failed to duplicate tab.");
                    }
                };

                void createDuplicate();
            } else {
                console.warn("[obsidian-flow] Drag source leaf had no readable state or failed resolution");
                new Notice("ObsidianFlow: Could not resolve exact dragged tab.");
            }
        });
    }
}
