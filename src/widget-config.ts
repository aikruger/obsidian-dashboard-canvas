export interface WidgetConfig {
  id: string;            // unique id for this widget instance
  viewType: string;      // Obsidian view type string, e.g. "full-calendar-view"
  label: string;         // Display title for the widget chrome
  x: number;            // px from left of canvas
  y: number;            // px from top of canvas
  w: number;            // width in px
  h: number;            // height in px
  filePath?: string;    // filePath for markdown note view type
}

export interface DashboardSettings {
  widgets: WidgetConfig[];
  canvasBackground: string; // CSS color or "default"
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  widgets: [],
  canvasBackground: 'default',
};
