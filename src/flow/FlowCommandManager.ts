import { App } from "obsidian";
import type ObsidianFlowPlugin from "../main";
import { FlowContext } from "./FlowContext";
import { getCommandsFromApp } from "./FlowUtils";

export class FlowCommandManager {
    plugin: ObsidianFlowPlugin;
    app: App;

    constructor(plugin: ObsidianFlowPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    registerCommandsForContexts() {
        const contexts = this.plugin.settings.flowContexts;

        let count = 0;
        if (contexts) {
            for (const context of contexts) {
                this.registerCommand(context);
                count++;
            }
        }
        console.log("[obsidian-flow] All context commands registered", count);
    }

    registerCommand(context: FlowContext) {
        console.log("[obsidian-flow] Registering command for context", context.name);

        const commandId = `open-context-${context.id}`;

        this.plugin.addCommand({
            id: commandId,
            name: `Open "${context.name}"`,
            callback: () => {
                console.log("[obsidian-flow] Command invoked: open context", context.name);
                void this.plugin.serializer.restoreContext(this.plugin.flowWindow, context.id);
            }
        });
    }

    unregisterCommand(contextId: string) {
        const fullId = `${this.plugin.manifest.id}:open-context-${contextId}`;
        const commands = getCommandsFromApp(this.app);
        if (commands && commands.removeCommand) {
            commands.removeCommand(fullId);
        }
    }
}
