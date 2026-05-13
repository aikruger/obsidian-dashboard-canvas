import { App, SuggestModal, TFile } from 'obsidian';

export class MarkdownFileSuggestModal extends SuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search markdown notes...');
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault.getMarkdownFiles().filter(f =>
      f.path.toLowerCase().includes(q)
    );
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.createEl('div', { text: file.basename });
    el.createEl('small', { text: file.path, cls: 'dashboard-suggest-path' });
  }

  onChooseSuggestion(file: TFile) {
    console.debug('[Dashboard][MarkdownFileSuggest] Chosen:', file.path);
    this.onChoose(file);
  }
}