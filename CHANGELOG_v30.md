# 3D Model Editor v30

## Undo / Redo History Panel

- Added a bottom **History** tab.
- Shows all command-pattern actions currently available in the undo/redo stacks.
- Displays executed and redoable commands separately through row state.
- Added **Start State** row to undo all commands.
- Clicking a history row jumps backward or forward to that command state.
- Includes command labels such as Add Object, Move/Rotate/Scale Object, Geometry Tool, Delete, Rename, Import Model, Apply Material, Apply Texture, and Add Keyframe.

## Guide modal expansion

- Expanded the Guide modal with usage details for all major editor tools and features:
  - Layout and viewport navigation.
  - Selection modes and left toolbar.
  - Scene hierarchy.
  - Modeling tools.
  - Snap, Align, UV Mapping, Texture Controls, Multi-material, Array.
  - Material Asset and texture upload.
  - Animation and Dope Sheet.
  - Save/Load and model import/export.
  - Camera objects.
  - View modes.
  - Grid and measurement tools.
  - Undo/Redo History panel.

## Structure

- Added `src/ui/HistoryPanelManager.js` for the History panel UI.
