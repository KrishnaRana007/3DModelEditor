# 3D Model Editor v7 - Hover Highlight + Edge Mode

## Added

- Added a new **Edge** mode to the viewport right-click Mode menu.
- Added mode-specific hover illumination:
  - Face Mode: hovered triangulated face highlights in yellow.
  - Edge Mode: hovered triangle edge highlights in yellow.
  - Vertex Mode: hovered vertex highlights in yellow.
- Added different selected-component colors:
  - Selected faces use orange translucent overlay.
  - Selected edges use green line overlay.
  - Selected vertices use blue vertex markers.
- Added Edge Mode component selection:
  - Click selects nearest triangle edge under the pointer.
  - Shift + click toggles multiple edge selection.
  - Drag rectangle selects multiple edges.
  - Move/Rotate/Scale transform selected edges using the existing gizmo workflow.
  - Edge movement remains welded to the mesh by transforming equivalent/coincident vertices.

## Preserved

- Fully offline local Three.js setup.
- Default cube at origin.
- Left-side Tools panel.
- Select tool hides gizmo.
- Object and Light dropdown creation menus.
- Alt + mouse orbit controls.
- Rectangle selection without Ctrl.
- Object / Face / Vertex modes.
- Triangulated face selection and attached face deformation.
- Undo/Redo command pattern for add/delete/transform and component geometry changes.
