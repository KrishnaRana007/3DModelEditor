/**
 * HistoryPanelManager renders the command-pattern undo/redo stack.
 *
 * The panel is intentionally UI-only. It does not know how commands work;
 * it only asks the application to jump to a history position.
 */
export class HistoryPanelManager {
  constructor({ container = null } = {}) {
    this.container = container;
  }

  getCommandLabel(command) {
    if (!command) return 'Unknown Command';
    if (command.label) return command.label;
    const name = command.constructor?.name || 'Command';
    const map = {
      AddObjectCommand: 'Add Object',
      AddMultipleObjectsCommand: 'Add Multiple Objects',
      ImportModelCommand: 'Import Model',
      DeleteObjectsCommand: 'Delete Object',
      RenameObjectCommand: 'Rename Object',
      ObjectVisibilityCommand: 'Hide / Show Object',
      ObjectLockCommand: 'Lock / Unlock Object',
      ParentObjectCommand: 'Parent / Child Hierarchy Change',
      ObjectTransformCommand: 'Move / Rotate / Scale Object',
      ComponentGeometryCommand: 'Edit Component Geometry',
      GeometryReplaceCommand: 'Geometry Tool'
    };
    return map[name] || name.replace(/Command$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  getCommandMeta(command) {
    const name = command?.constructor?.name || 'Command';
    if (name.includes('Add') || name === 'ImportModelCommand') return { icon: '+', type: 'Create' };
    if (name.includes('Delete')) return { icon: '×', type: 'Delete' };
    if (name.includes('Transform')) return { icon: '↔', type: 'Transform' };
    if (name.includes('Geometry') || name.includes('Component')) return { icon: '▧', type: 'Geometry' };
    if (name.includes('Rename')) return { icon: '✎', type: 'Hierarchy' };
    if (name.includes('Visibility')) return { icon: '◉', type: 'Hierarchy' };
    if (name.includes('Lock')) return { icon: '🔒', type: 'Hierarchy' };
    if (name.includes('Parent')) return { icon: '↳', type: 'Hierarchy' };
    return { icon: '•', type: 'Command' };
  }

  render(commandManager, jumpToPosition) {
    if (!this.container || !commandManager) return;

    const executed = commandManager.undoStack || [];
    const undone = [...(commandManager.redoStack || [])].reverse();
    const all = [...executed, ...undone];
    const currentPosition = executed.length;

    this.container.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'history-panel';

    const toolbar = document.createElement('div');
    toolbar.className = 'history-toolbar';
    toolbar.innerHTML = `
      <div>
        <strong>Undo / Redo History</strong>
        <span>${executed.length} executed · ${undone.length} redoable</span>
      </div>
      <div class="history-toolbar-help">Click a row to jump to that state</div>
    `;
    shell.appendChild(toolbar);

    const list = document.createElement('div');
    list.className = 'history-list';

    const start = document.createElement('button');
    start.type = 'button';
    start.className = `history-row history-start ${currentPosition === 0 ? 'current' : ''}`;
    start.innerHTML = `
      <span class="history-index">0</span>
      <span class="history-icon">⏮</span>
      <span class="history-label"><strong>Start State</strong><em>Before any command</em></span>
      <span class="history-state">${currentPosition === 0 ? 'Current' : 'Jump'}</span>
    `;
    start.addEventListener('click', () => jumpToPosition?.(0));
    list.appendChild(start);

    if (!all.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No commands yet. Add, move, delete, extrude, import, rename, keyframe, or edit material to populate history.';
      list.appendChild(empty);
    }

    all.forEach((command, index) => {
      const position = index + 1;
      const isExecuted = position <= currentPosition;
      const isCurrent = position === currentPosition;
      const meta = this.getCommandMeta(command);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `history-row ${isExecuted ? 'executed' : 'undone'} ${isCurrent ? 'current' : ''}`;
      row.innerHTML = `
        <span class="history-index">${position}</span>
        <span class="history-icon">${meta.icon}</span>
        <span class="history-label"><strong>${this.escapeHtml(this.getCommandLabel(command))}</strong><em>${meta.type}</em></span>
        <span class="history-state">${isCurrent ? 'Current' : isExecuted ? 'Done' : 'Undone'}</span>
      `;
      row.addEventListener('click', () => jumpToPosition?.(position));
      list.appendChild(row);
    });

    shell.appendChild(list);
    this.container.appendChild(shell);
  }

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }
}
