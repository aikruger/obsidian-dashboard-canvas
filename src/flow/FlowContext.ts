export interface FlowLeafState {
    id: string;
    type: string;
    state: Record<string, unknown>;
    eState?: Record<string, unknown>;
    icon?: string;
    customTitle?: string;
}

export interface FlowSplitState {
    direction: "horizontal" | "vertical";
    ratio: number;
    children: Array<FlowSplitState | FlowLeafState>;
}

export interface FlowContext {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    windowBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    layout: FlowSplitState | FlowLeafState;
    activeLeafId: string;
}

export interface ObsidianFlowSettings {
    flowContexts: FlowContext[];
    openOnStartup: boolean;
    defaultContextId: string | null;
    rememberLastContext: boolean;
}

export const DEFAULT_SETTINGS: ObsidianFlowSettings = {
    flowContexts: [],
    openOnStartup: false,
    defaultContextId: null,
    rememberLastContext: true
};
