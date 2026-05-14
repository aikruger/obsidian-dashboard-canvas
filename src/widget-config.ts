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

export interface DashboardSettings {
  widgets: WidgetConfig[];
  canvasBackground: string;   // CSS colour string or 'default'
  altScrollHorizontal: boolean; // Alt+wheel scrolls canvas horizontally
  altScrollSpeed: number;       // px per wheel tick for alt-scroll
  snapToGrid: boolean;
  gridSize: number;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
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