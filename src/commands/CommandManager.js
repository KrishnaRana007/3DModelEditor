/**
 * Generic command-pattern base. Feature-specific commands can extend Command.
 *
 * The legacy runtime still contains concrete command classes because they close
 * over editor functions. New commands should be added here and injected with the
 * callbacks they need.
 */
export class Command {
  execute() {}
  undo() {}
  hasChanges() { return true; }
}

export class CommandManagerBase {
  constructor({ onChange = null } = {}) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange;
  }

  execute(command) {
    if (!command) return;
    command.execute();
    this.undoStack.push(command);
    this.redoStack.length = 0;
    this.onChange?.();
  }

  record(command) {
    if (!command || (typeof command.hasChanges === 'function' && !command.hasChanges())) return;
    this.undoStack.push(command);
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
    this.onChange?.();
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return;
    command.execute();
    this.undoStack.push(command);
    this.onChange?.();
  }
}
