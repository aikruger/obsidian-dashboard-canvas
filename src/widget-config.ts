// widget-config.ts

export interface WidgetConfig {
  id: string;
  viewType: string;       // discovered dynamically — never hardcoded
  label: string;          // the display name shown in the widget title bar
  filePath?: string;      // only needed for markdown/canvas file-based views
  openCommandId?: string; // optional: command to fire if no leaf exists yet
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardSettings {
  widgets: WidgetConfig[];
  canvasBackground: string;
  snapToGrid: boolean;
  gridSize: number;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  widgets: [],
  canvasBackground: 'default',
  snapToGrid: false,
  gridSize: 20,
  zoom: 1,
  panX: 0,
  panY: 0,
};