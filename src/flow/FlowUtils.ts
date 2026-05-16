import { WorkspaceLeaf, App } from "obsidian";
import type { FlowTabs } from "./FlowTabs";

export interface FlowDragSession {
    type: string;
    state: Record<string, unknown>;
    eState: Record<string, unknown> | null;
    sourceInternal?: boolean;
    sourceLeaf?: WorkspaceLeaf;
    sourceTabs?: FlowTabs;
    leaf?: WorkspaceLeaf;
}

export function resolveDraggedLeafFromEvent(event: DragEvent | null, currentDragSession: FlowDragSession | null): FlowDragSession | null {
    console.log("[obsidian-flow] resolveLeafFromTabEl invoked");
    console.log("[obsidian-flow] drag session captured", currentDragSession);
    if (currentDragSession) {
        return currentDragSession;
    }
    console.warn("[obsidian-flow] unresolved dragged leaf");
    return null;
}

export function getParentRemover(leaf: WorkspaceLeaf): { removeChild: (child: WorkspaceLeaf) => void } | null {
    if (leaf.parent) {
        const p = leaf.parent as unknown as { removeChild: (child: WorkspaceLeaf) => void };
        if (p && typeof p.removeChild === 'function') {
            return p;
        }
    }
    return null;
}

export function getLeafId(leaf: WorkspaceLeaf): string {
    const leafAny = leaf as unknown as { id: string };
    return leafAny.id || 'leaf-' + Date.now().toString();
}

export function getLeafContainer(leaf: WorkspaceLeaf): HTMLElement | null {
    const leafAny = leaf as unknown as { containerEl?: HTMLElement };
    return leafAny.containerEl || null;
}

export function getTabHeaderEl(leaf: WorkspaceLeaf): HTMLElement | null {
    const leafAny = leaf as unknown as { tabHeaderEl?: HTMLElement };
    return leafAny.tabHeaderEl || null;
}

export function getCommandsFromApp(app: App): { removeCommand: (id: string) => void } | null {
    const appAny = app as unknown as { commands?: { removeCommand: (id: string) => void } };
    return appAny.commands || null;
}

export function getFileExtension(file: unknown): string | null {
    const fAny = file as { extension?: string };
    return fAny.extension || null;
}
