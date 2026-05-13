import interact from 'interactjs';
import { WidgetConfig } from './widget-config';

export class LayoutManager {
  private canvasEl: HTMLElement;
  private onLayoutChange: (widgets: WidgetConfig[]) => void;
  private widgets: WidgetConfig[];
  private getZoom: () => number;

  constructor(
    canvasEl: HTMLElement,
    widgets: WidgetConfig[],
    onLayoutChange: (widgets: WidgetConfig[]) => void,
    getZoom: () => number
  ) {
    this.canvasEl = canvasEl;
    this.widgets = widgets;
    this.onLayoutChange = onLayoutChange;
    this.getZoom = getZoom;
    console.debug('[Dashboard][LayoutManager] Initialised with', widgets.length, 'widgets');
  }

  applyToSlot(slotEl: HTMLElement, config: WidgetConfig) {
    slotEl.style.left = `${config.x}px`;
    slotEl.style.top = `${config.y}px`;
    slotEl.style.width = `${config.w}px`;
    slotEl.style.height = `${config.h}px`;
    console.debug(`[Dashboard][LayoutManager] Applied slot "${config.id}": x=${config.x}, y=${config.y}, w=${config.w}, h=${config.h}`);
  }

  attachInteract(slotEl: HTMLElement, config: WidgetConfig) {
    console.debug(`[Dashboard][LayoutManager] Attaching interact.js to slot "${config.id}"`);

    interact(slotEl)
      .draggable({
        allowFrom: '.dashboard-widget-handle',
        listeners: {
          move: (event: { dx: number; dy: number }) => {
            const scale = this.getZoom();
            config.x += event.dx / scale;
            config.y += event.dy / scale;
            slotEl.style.left = `${config.x}px`;
            slotEl.style.top = `${config.y}px`;
          },
          end: () => {
            console.debug(`[Dashboard][LayoutManager] Drag end "${config.id}": x=${Math.round(config.x)}, y=${Math.round(config.y)}`);
            this.onLayoutChange(this.widgets);
          },
        },
      })
      .resizable({
        edges: { right: true, bottom: true },
        listeners: {
          move: (event: { rect: { width: number; height: number } }) => {
            const scale = this.getZoom();
            config.w = event.rect.width / scale;
            config.h = event.rect.height / scale;
            slotEl.style.width = `${config.w}px`;
            slotEl.style.height = `${config.h}px`;
          },
          end: () => {
            console.debug(`[Dashboard][LayoutManager] Resize end "${config.id}": w=${Math.round(config.w)}, h=${Math.round(config.h)}`);
            this.onLayoutChange(this.widgets);
          },
        },
        modifiers: [
          interact.modifiers.restrictSize({ min: { width: 200, height: 150 } }),
        ],
      });
  }
}