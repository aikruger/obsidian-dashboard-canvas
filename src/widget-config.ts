export interface WidgetConfig {
  id: string;        // Unique widget instance ID, e.g. "widget-1715812345678"
  viewType: string;  // Obsidian view type string, e.g. "full-calendar-view", "markdown"
  label: string;     // Title shown in the widget chrome
  filePath?: string; // Required when viewType === "markdown"
  x: number;         // Left offset in px from canvas origin
  y: number;         // Top offset in px from canvas origin
  w: number;         // Width in px
  h: number;         // Height in px
}

export interface DashboardSettings {
  widgets: WidgetConfig[];
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  widgets: [],
};
