import { App, SuggestModal } from 'obsidian';

export interface PluginViewOption {
  type: string;
  label: string;
}

export class PluginViewSelectModal extends SuggestModal<PluginViewOption> {
  private options: PluginViewOption[];
  private onChoose: (option: PluginViewOption) => void;

  constructor(app: App, options: PluginViewOption[], onChoose: (option: PluginViewOption) => void) {
    super(app);
    this.options = options;
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search plugin views...');
  }

  getSuggestions(query: string): PluginViewOption[] {
    const q = query.toLowerCase();
    return this.options.filter(o =>
      o.type.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
    );
  }

  renderSuggestion(option: PluginViewOption, el: HTMLElement) {
    el.createEl('div', { text: option.label });
    el.createEl('small', { text: option.type, cls: 'dashboard-suggest-path' });
  }

  onChooseSuggestion(option: PluginViewOption) {
    console.debug('[Dashboard][PluginViewSelect] Chosen:', option.type);
    this.onChoose(option);
  }
}