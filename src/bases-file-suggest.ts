import { App, SuggestModal, TFile } from 'obsidian';

export class BasesFileSuggestModal extends SuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search .base files...');
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault.getFiles()
      .filter(f => f.extension === 'base' && f.path.toLowerCase().includes(q));
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path, cls: 'dashboard-suggest-path' });
  }

  onChooseSuggestion(file: TFile) {
    console.debug('[Dashboard][BasesFileSuggest] Chosen:', file.path);
    this.onChoose(file);
  }
}