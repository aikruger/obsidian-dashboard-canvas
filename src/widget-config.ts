export type WidgetKind = 'markdown' | 'canvas' | 'plugin';

export interface WidgetConfig {
  id: string;
  kind: WidgetKind;
  viewType: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  filePath?: string;
  pluginId?: string;
  pluginState?: unknown;
}

export interface DashboardSettings {
  widgets: WidgetConfig[];
  canvasBackground: string;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  widgets: [],
  canvasBackground: 'default',
  zoom: 1,
  panX: 0,
  panY: 0,
};