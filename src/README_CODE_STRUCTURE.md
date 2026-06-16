# 3D Model Editor - v21 Code Structure

This version reorganizes the project into role-based modules so it is easier to understand where to add each new feature.

## Entry points

```text
index.html
app.js                         compatibility wrapper
src/main.js                    small bootstrap file
src/app/EditorApp.js           main editor application composition/runtime
```

`src/app/EditorApp.js` still contains the integrated runtime logic from earlier versions so the editor remains stable. New code should be moved into the role-based modules below instead of adding more logic directly into `EditorApp.js`.

## Folder roles

```text
src/core/
  DomRefs.js                   all fixed DOM element lookups
  SceneManager.js              Three.js scene, camera, renderer, orbit, transform gizmo, grid, axes, overlay materials

src/assets/
  AssetManager.js              material type registry, material labels, texture/material registry

src/tools/
  ToolRegistry.js              object/light type ids, labels, default modeling settings
  ModelingTools.js             target home for Extrude, Bevel, Chamfer, Multicut, Mirror implementations

src/input/
  MouseEventManager.js         target home for viewport pointer/click/drag/context-menu/orbit event handling

src/selection/
  SelectionManager.js          target home for object/face/edge/vertex selection state

src/animation/
  AnimationTimelineHelpers.js  timeline visible range, pointer-to-frame conversion, playhead sync helpers

src/ui/
  PanelManager.js              target home for bottom tabs, dialogs, flyouts and panel switching

src/commands/
  CommandManager.js            reusable command-pattern base classes for undo/redo
```

## Where to add new code

| Feature area | Add/modify here |
|---|---|
| Three.js renderer, scene, camera, orbit/transform controls | `src/core/SceneManager.js` |
| HTML element lookup | `src/core/DomRefs.js` |
| Material dropdown, material defaults, texture upload registry | `src/assets/AssetManager.js` |
| Object/light/tool ids and labels | `src/tools/ToolRegistry.js` |
| Modeling tools like Extrude/Bevel/Chamfer/Multicut/Mirror | `src/tools/ModelingTools.js` |
| Mouse click, drag, rectangle select, context menu, Alt-orbit input | `src/input/MouseEventManager.js` |
| Object/Face/Edge/Vertex selection state | `src/selection/SelectionManager.js` |
| Timeline scrub/playhead math | `src/animation/AnimationTimelineHelpers.js` |
| Bottom tabs, guide modal, inspector UI, flyouts | `src/ui/PanelManager.js` |
| Undo/Redo command base classes | `src/commands/CommandManager.js` |

## Current compatibility note

The previous versions grew inside a single runtime file. In v21, the critical bootstrapping and registries have been moved into role-based modules while the tested editor behavior is preserved. Future updates should progressively move the remaining legacy functions from `src/app/EditorApp.js` into the role folders above.


## v22 added tool locations

The following tools are exposed from the top Tools menu and viewport context menu. Their runtime functions are currently wired in `src/app/EditorApp.js` so they remain compatible with the existing selection, command, material, and animation state. Future cleanup can move each function into the matching manager module without changing UI behavior.

- Delete Tool: object deletion and component triangle deletion.
- Duplicate Tool: object/component duplication and Ctrl+D shortcut.
- Snap Tool: grid/rotation/scale snapping for object and component transforms.
- Align Tool: axis-based Min/Center/Max alignment.
- UV Mapping Tool: Box, Planar, Cylindrical, and Spherical UV generation.
- Texture Controls: texture repeat, offset, rotation, wrapping, and FlipY.
- Multi-material Face Assignment: assigns a separate material to selected faces.
- Array Tool: linear and circular object arrays.

## v23 Animation Dope Sheet

The Dope Sheet implementation is currently in `src/app/EditorApp.js` beside the existing animation keyframe engine. The visual timeline math still uses `src/animation/AnimationTimelineHelpers.js`.

Main responsibilities:
- Dope Sheet row definitions: `DOPESHEET_ROWS`
- Selected object track lookup: `getPrimaryDopeSheetRecord()`
- Key move/delete actions: `moveAnimationKey()` and `deleteAnimationKey()`
- Dope Sheet rendering: `renderDopeSheet()`

Future improvement: move these functions into `src/animation/DopeSheet.js` after the animation system is split into a dedicated class.


## Project I/O

`src/io/ProjectIOManager.js` contains file download/upload helpers and the custom XML wrapper used by Save/Load Project. Live Three.js scene serialization is coordinated from `EditorApp.js` because it owns scene objects, materials, textures, camera, selection, timeline/keyframes, and editor state.

## Model Import / Export

`src/io/ModelIOManager.js`

Handles 3D model file import/export separate from project save/load.

Responsibilities:
- Import OBJ, STL, GLTF/GLB into Three.js objects.
- Export selected scene meshes or full editable scene meshes as OBJ, STL, GLTF, or GLB.
- Keep model format parsing separate from `ProjectIOManager.js`, which is only for custom editor project JSON/XML.

## v26 hierarchy notes

Project Structure / hierarchy behavior is currently implemented in `src/app/EditorApp.js` through:

- `refreshSceneTree()` and `renderSceneTreeNode()` for hierarchy UI.
- `ParentObjectCommand` for drag-drop parenting/unparenting.
- `RenameObjectCommand`, `ObjectVisibilityCommand`, and `ObjectLockCommand` for row actions.
- `serializeObject()` / `applyProjectData()` for saving and restoring parent IDs, visibility, and lock state.

Future extraction target: move hierarchy UI/actions into `src/ui/HierarchyPanelManager.js` once the hierarchy feature set stabilizes.

## Camera Object Extension

Camera object creation and camera-view actions are currently wired in `src/app/EditorApp.js` because they must coordinate SceneManager, hierarchy, inspector, save/load, and animation state together. Camera creation IDs are registered in `src/tools/ToolRegistry.js`, while fixed DOM references for camera toolbar controls are kept in `src/core/DomRefs.js`.


## View Modes

`src/view/ViewModeManager.js` owns Solid, Wireframe, Material Preview, Rendered Preview, X-Ray, Normal and UV debug view modes. It applies display-only material overrides and keeps real materials safe for save/export.

## v29 Grid and Measurement Tools

Grid and measurement logic is separated into:

```text
src/tools/GridMeasurementTools.js
```

Use this file for:

- Editor grid size/division management.
- Unit conversion for measurements.
- Ruler tool overlays.
- Distance measurement overlays.
- Angle measurement overlays.
- Clearing measurement markers and labels.

The main app only forwards viewport click points to this manager when the Grid / Measurement tool is active.

## v30 Undo / Redo History Panel

The History panel UI is separated into:

```text
src/ui/HistoryPanelManager.js
```

Responsibilities:
- Render the current command-pattern undo/redo stack.
- Show executed commands and redoable commands.
- Provide click-to-jump behavior through a callback owned by `EditorApp.js`.

Runtime command execution is still coordinated by `EditorApp.js` because command classes close over scene, selection, inspector, material, animation, hierarchy, and import/export state. New UI-only history behavior should be added in `HistoryPanelManager.js`; new undoable editor actions should use command classes in `EditorApp.js` or future dedicated command modules.
