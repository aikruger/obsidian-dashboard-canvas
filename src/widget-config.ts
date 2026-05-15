// widget-config.ts

export interface WidgetConfig {
  id: string;
  viewType: string;
  label: string;
  filePath?: string;
  openCommandId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SavedLayout {
  id: string;
  name: string;
  widgets: WidgetConfig[];
  zoom?: number;
  panX?: number;
  panY?: number;
  createdAt: number;
}

export interface DashboardSettings {
  activeLayoutId: string | null;   // which layout is currently loaded
  layouts: SavedLayout[];          // all named layouts
  canvasBackground: string;
  altScrollHorizontal: boolean;
  altScrollSpeed: number;
  snapToGrid: boolean;
  gridSize: number;
  // These remain for runtime only — synced from active layout on load
  widgets: WidgetConfig[];
  zoom?: number;
  panX?: number;
  panY?: number;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  activeLayoutId: null,
  layouts: [],
  widgets: [],
  canvasBackground: 'default',
  altScrollHorizontal: true,
  altScrollSpeed: 40,
  snapToGrid: false,
  gridSize: 20,
  zoom: 1,
  panX: 0,
  panY: 0,
};