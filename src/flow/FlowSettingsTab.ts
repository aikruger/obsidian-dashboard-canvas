import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type ObsidianFlowPlugin from "../main";
import { FlowContext } from "./FlowContext";

export class FlowSettingsTab extends PluginSettingTab {
    plugin: ObsidianFlowPlugin;

    constructor(app: App, plugin: ObsidianFlowPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'ObsidianFlow Settings' });

        new Setting(containerEl)
            .setName('Open on startup')
            .setDesc('Automatically open the default or last context on startup')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openOnStartup)
                .onChange(async (value) => {
                    this.plugin.settings.openOnStartup = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Remember last context')
            .setDesc('Reopen the last active context on next launch')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.rememberLastContext)
                .onChange(async (value) => {
                    this.plugin.settings.rememberLastContext = value;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl('h3', { text: 'Export / Import Contexts' });

        new Setting(containerEl)
            .setName('Export Contexts')
            .setDesc('Copy all contexts to clipboard as JSON')
            .addButton(btn => btn
                .setButtonText("Export")
                .onClick(async () => {
                    await navigator.clipboard.writeText(JSON.stringify(this.plugin.settings.flowContexts, null, 2));
                    new Notice("Contexts exported to clipboard.");
                })
            );

        new Setting(containerEl)
            .setName('Import Contexts')
            .setDesc('Paste JSON here to import contexts (overwrites current)')
            .addTextArea(text => text
                .setPlaceholder('Paste JSON here...')
                .onChange(async (value) => {
                    try {
                        const parsed = JSON.parse(value) as FlowContext[];
                        if (Array.isArray(parsed)) {
                            this.plugin.settings.flowContexts = parsed;
                            await this.plugin.saveSettings();
                            this.plugin.commandManager.registerCommandsForContexts();
                            new Notice("Contexts imported successfully.");
                            this.display();
                        }
                    } catch {
                        // ignore until valid json
                    }
                })
            );

        containerEl.createEl('h3', { text: 'Saved Contexts' });

        for (const context of this.plugin.settings.flowContexts) {
            new Setting(containerEl)
                .setName(context.name)
                .setDesc(`Created: ${new Date(context.createdAt).toLocaleString()}`)
                .addButton(btn => btn
                    .setButtonText("Open")
                    .onClick(() => {
                        void this.plugin.serializer.restoreContext(this.plugin.flowWindow, context.id);
                    })
                )
                .addButton(btn => btn
                    .setButtonText("Delete")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.flowContexts = this.plugin.settings.flowContexts.filter(c => c.id !== context.id);
                        this.plugin.commandManager.unregisterCommand(context.id);
                        await this.plugin.saveSettings();
                        this.display(); // refresh
                    })
                );
        }

        if (this.plugin.settings.flowContexts.length === 0) {
            containerEl.createEl('p', { text: 'No contexts saved yet.' });
        }
    }
}
