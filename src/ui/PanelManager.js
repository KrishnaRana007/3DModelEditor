/**
 * PanelManager owns UI panel/tab concepts.
 *
 * New bottom tabs, inspectors, dialogs and flyouts should be implemented here
 * instead of being mixed into scene or tool code.
 */
export class PanelManager {
  constructor({ documentRef = document } = {}) {
    this.document = documentRef;
  }

  activateTab(tabName) {
    this.document.querySelectorAll('[data-bottom-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.bottomTab === tabName);
    });
    this.document.querySelectorAll('[data-bottom-content]').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.bottomContent === tabName);
    });
  }
}
