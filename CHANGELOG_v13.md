# 3D Model Editor v13 - Extrude Workflow + Menu Cleanup

## Updated
- Removed the top-level **Create** menu from the main menu bar.
- Removed the **Selection / Gizmo** section from the top **Tools** menu. Select/Translate/Scale/Rotate remain available from the left toolbar.
- Kept modeling actions in the top **Tools** menu.

## Orbit Controls
- Preserved **Alt + left mouse drag** for orbit/rotate.
- Added **middle mouse drag** for pan through OrbitControls.
- Added **mouse wheel** zoom in / zoom out through OrbitControls.

## Extrude Tool - first focused modeling-tool pass
- Extrude now follows component-mode workflow:
  1. Switch to Face, Edge, or Vertex mode.
  2. Select one or multiple components.
  3. Run Extrude from top Tools or context menu.
  4. The newly extruded component is selected.
  5. Translate gizmo is attached immediately so the extrusion can be increased/decreased by dragging.
- Face extrusion selects the newly created triangulated top face.
- Edge extrusion selects the newly created outer edge.
- Vertex extrusion selects the newly created tip vertex.
- Added Extrude threshold controls in the bottom **Properties** tab:
  - Threshold X: -10 to 10
  - Threshold Y: -10 to 10
  - Threshold Z: -10 to 10

## Preserved
- Offline local Three.js setup.
- Default cube at origin.
- Left toolbar and icon flyouts.
- Bottom Inspector / Material Asset / Properties tabs.
- Context menu mode switching and modeling tools.
- Object, Face, Edge, Vertex selection and highlights.
- Undo/Redo command pattern.
