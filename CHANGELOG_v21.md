# 3D Model Editor v21

## Codebase restructuring

- Converted the project into a role-based `src/` folder structure.
- Added dedicated manager/registry modules:
  - `core/SceneManager.js`
  - `core/DomRefs.js`
  - `assets/AssetManager.js`
  - `tools/ToolRegistry.js`
  - `tools/ModelingTools.js`
  - `input/MouseEventManager.js`
  - `selection/SelectionManager.js`
  - `animation/AnimationTimelineHelpers.js`
  - `ui/PanelManager.js`
  - `commands/CommandManager.js`
- Changed `src/main.js` into a small bootstrap file.
- Moved the integrated editor runtime to `src/app/EditorApp.js`.
- Kept the editor offline and preserved v20 functionality.
