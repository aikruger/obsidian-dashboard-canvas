import interact from 'interactjs';
import { WidgetConfig } from './widget-config';

export class LayoutManager {
  private canvasEl: HTMLElement;
  private onLayoutChange: (widgets: WidgetConfig[]) => void;
  private widgets: WidgetConfig[];

  constructor(
    canvasEl: HTMLElement,
    widgets: WidgetConfig[],
    onLayoutChange: (widgets: WidgetConfig[]) => void
  ) {
    this.canvasEl = canvasEl;
    this.widgets = widgets;
    this.onLayoutChange = onLayoutChange;
    console.debug('[Dashboard][LayoutManager] Initialised with', widgets.length, 'widgets');
  }

  applyToSlot(slotEl: HTMLElement, config: WidgetConfig) {
    slotEl.style.left = `${config.x}px`;
    slotEl.style.top = `${config.y}px`;
    slotEl.style.width = `${config.w}px`;
    slotEl.style.height = `${config.h}px`;
    console.debug(`[Dashboard][LayoutManager] Applied position to slot "${config.id}": x=${config.x}, y=${config.y}, w=${config.w}, h=${config.h}`);
  }

  attachInteract(slotEl: HTMLElement, config: WidgetConfig) {
    console.debug(`[Dashboard][LayoutManager] Attaching interact.js to slot "${config.id}"`);

    interact(slotEl)
      .draggable({
        allowFrom: '.dashboard-widget-handle',
        listeners: {
          move: (event: { dx: number, dy: number }) => {
            config.x += event.dx;
            config.y += event.dy;
            slotEl.style.left = `${config.x}px`;
            slotEl.style.top = `${config.y}px`;
          },
          end: () => {
            console.debug(`[Dashboard][LayoutManager] Drag end for "${config.id}": x=${config.x}, y=${config.y}`);
            this.onLayoutChange(this.widgets);
          },
        },
      })
      .resizable({
        edges: { right: true, bottom: true },
        listeners: {
          move: (event: { rect: { width: number, height: number } }) => {
            config.w = event.rect.width;
            config.h = event.rect.height;
            slotEl.style.width = `${config.w}px`;
            slotEl.style.height = `${config.h}px`;
          },
          end: () => {
            console.debug(`[Dashboard][LayoutManager] Resize end for "${config.id}": w=${config.w}, h=${config.h}`);
            this.onLayoutChange(this.widgets);
          },
        },
        modifiers: [
          interact.modifiers.restrictSize({ min: { width: 200, height: 150 } }),
        ],
      });
  }
}
