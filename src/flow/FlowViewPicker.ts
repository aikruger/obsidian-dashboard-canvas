import { App, FuzzySuggestModal, TFile } from "obsidian";
import { FlowWindow } from "./FlowWindow";
import { getParentRemover, getFileExtension } from "./FlowUtils";

export class FlowViewPicker extends FuzzySuggestModal<string> {
    flowWindow: FlowWindow;

    constructor(app: App, flowWindow: FlowWindow) {
        super(app);
        this.flowWindow = flowWindow;
    }

    getItems(): string[] {
        const files = this.app.vault.getFiles().map(f => f.path);
        return files;
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string): void {
        const createLeaf = async () => {
            const file = this.app.vault.getAbstractFileByPath(item);
            const ext = getFileExtension(file);
            if (file && ext) {
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(file as TFile);

                const p = getParentRemover(leaf);
                if (p) {
                    p.removeChild(leaf);
                }
                this.flowWindow.rootTabs.addLeaf(leaf);
            }
        };
        void createLeaf();
    }
}
