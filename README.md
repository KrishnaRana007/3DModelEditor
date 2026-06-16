# 3D Model Editor - Offline Starter v6

This is a fully offline Three.js-based 3D Model Editor starter inspired by Blender/Maya/nunuStudio-style editor layouts.

## Run

From this folder:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Main Controls

- Default scene starts with **Cube at Origin**.
- Hold **Alt + mouse drag** to orbit the viewport.
- Normal left-drag performs rectangular selection.
- Click selects one object/component.
- Shift + click adds/removes from selection.
- Right-click viewport -> Mode -> Object / Face / Vertex.

## Left Tools Panel

### Select
- Select is active by default.
- When Select is active, no gizmo is visible.
- Selected mesh objects are shown with a blue wireframe overlay.

### Gizmo
- Move, Rotate, Scale buttons activate TransformControls.
- When a gizmo mode is active, selected object(s), face(s), or vertex group(s) can be transformed.

### Object
Click **Object** to open primitive options:
- Cube
- Sphere
- Plane
- Cylinder
- Cone

### Light
Click **Light** to open light options:
- Directional Light
- Point Light
- Ambient Light

## Undo/Redo

Undo/Redo is implemented using a command pattern.

Supported commands:
- Add primitive object
- Add light
- Delete selected object(s)
- Object transform
- Face/vertex geometry transform

Shortcuts:
- Ctrl+Z = Undo
- Ctrl+Y = Redo
- Ctrl+Shift+Z = Redo


## v7 Updates

- Face and Vertex modes now have hover illumination before selection.
- Selected components use a separate color from hovered components.
- Added Edge mode under Right Click > Mode > Edge.
- Edge mode supports click selection, Shift-click multi-selection, rectangle selection, and Move/Rotate/Scale transforms.
- Edge transforms use the same attached/welded geometry behaviour as Face and Vertex component transforms.


## v8 Basic Modeling Tools

This version adds starter 3D modeling tools available from three places:

1. Right-click viewport context menu
2. Top **Tools** menu
3. Left **Model Tools** group

Tools included:

- Extrude
- Bevel
- Chamfer
- Multicut
- Mirror X/Y/Z

A **Guide** button is available in the top menu. It opens a detailed modal explaining how the editor works and how to use every tool step by step.

### Notes

These are practical browser-editor starter implementations, not yet full Blender/Maya-grade topology systems. They are implemented through command-pattern geometry replacement so Undo/Redo works for topology changes.


## v9 UI Note

- The left **Object** and **Light** buttons now open their options as right-side context-style flyout panels instead of expanding downward inside the Tools panel.
- Scrollbars are custom-styled for a cleaner editor look.


## v10 Update
- Left-side Tools panel has been removed.
- Use the top **Create** menu or viewport right-click **Create** submenu to add objects and lights.
- Use the top **Tools** menu or viewport right-click menu for Select, Move, Rotate, Scale and modeling tools.
- Bottom section now has three tabs: **Inspector**, **Material Asset**, and **Properties**. Inspector opens by default.
- Context submenus such as Mode and Mirror have been stabilized so they stay open while moving the mouse into the submenu.


## v11 UI note

The left toolbar is restored and intentionally limited to Select, Translate, Scale, Rotate, Object and Light. Object and Light open right-side, multi-row icon flyouts.


## v13 Notes

- The top Create menu has been removed. Use the left Object/Light toolbar flyouts to add scene items.
- The top Tools menu now focuses on modeling tools only; Select/Translate/Scale/Rotate stay in the left toolbar.
- OrbitControls: Alt + left mouse rotates, middle mouse pans, and mouse wheel zooms.
- Extrude workflow: switch to Face/Edge/Vertex mode, select components, run Extrude, then drag the attached Translate gizmo. The Properties tab includes Threshold X/Y/Z controls from -10 to 10.

## v14 Extrude Properties Fix

The Extrude tool now uses tool-compatible property names:

- Extrude Amount X
- Extrude Amount Y
- Extrude Amount Z

After selecting Face, Edge, or Vertex components and running Extrude, the Translate gizmo attaches to the newly extruded component. You can adjust the same active extrusion either by dragging the gizmo or by editing the Extrude Amount X/Y/Z controls in the Properties tab. Values are limited from -10 to 10.


## v20 code structure update

The project now uses a clearer JavaScript structure:

- `src/main.js` contains the main editor runtime.
- `src/animationTimelineHelpers.js` contains the animation timeline scrub/playhead helpers.
- root `app.js` remains as a compatibility wrapper.

Animation timeline fixes in v20:

- Timeline playhead now moves smoothly during playback.
- Timeline playhead follows the mouse while scrubbing.
- Scrubbing updates the current frame and object state immediately.

## v21 role-based source structure

The project now uses a clearer module layout under `src/`:

- `src/main.js` - bootstrap only
- `src/app/EditorApp.js` - current integrated editor runtime
- `src/core/SceneManager.js` - Three.js scene/camera/renderer/controls/overlays
- `src/core/DomRefs.js` - DOM references
- `src/assets/AssetManager.js` - material and texture registry
- `src/tools/ToolRegistry.js` - object, light and tool metadata
- `src/tools/ModelingTools.js` - target home for modeling tools
- `src/input/MouseEventManager.js` - target home for mouse/pointer input
- `src/selection/SelectionManager.js` - target home for selection state
- `src/animation/AnimationTimelineHelpers.js` - timeline helpers
- `src/ui/PanelManager.js` - panel/flyout/tab UI helper
- `src/commands/CommandManager.js` - command-pattern base

See `src/README_CODE_STRUCTURE.md` for details.

## v27 Camera Objects

Camera objects can be created from the left toolbar Camera flyout or from the viewport context Create menu. Select a camera and use View → View Through Selected Camera, or use the Inspector button, to preview the scene from that camera. The viewport displays a camera frame overlay while camera view is active. Camera objects participate in the same hierarchy, save/load, and animation systems as other editable scene objects.
