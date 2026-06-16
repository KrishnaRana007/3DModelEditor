# CHANGELOG v8 - Basic Modeling Tools + Guide

## Added
- Added top **Tools** menu with:
  - Extrude
  - Bevel
  - Chamfer
  - Multicut
  - Mirror X / Mirror Y / Mirror Z
- Added the same modeling tools to the viewport right-click context menu.
- Added a **Model Tools** group in the left Tools panel for quick access.
- Added **Guide** button in the top menu.
- Added detailed Guide modal explaining the project layout, navigation, selection modes, transform tools, Extrude, Bevel, Chamfer, Multicut, Mirror, and Undo/Redo.
- Added topology-safe command pattern support through `GeometryReplaceCommand` for modeling tools that add or replace geometry.

## Tool behavior in this starter version
- **Extrude**:
  - Face mode: extrudes selected triangulated faces along their normals and creates connected side geometry.
  - Edge mode: creates connected strip geometry from selected edges.
  - Vertex mode: creates a small connected spike marker from selected vertices.
- **Bevel** and **Chamfer**:
  - First-pass component offset tools for selected faces, edges, or vertices.
  - Chamfer uses stronger straight offset than Bevel.
- **Multicut**:
  - Face mode: splits selected triangulated faces through the center into smaller triangles.
- **Mirror**:
  - Object mode: creates mirrored duplicate objects on X/Y/Z.
  - Component modes: appends mirrored selected component geometry where practical.

## Preserved
- Fully offline Three.js setup.
- Default cube at origin.
- Alt + mouse orbit control.
- Rectangle selection without Ctrl.
- Shift + click multi-selection.
- Object / Face / Edge / Vertex modes.
- Hover and selected component highlights.
- Select tool hides gizmo and shows wireframe selection.
- Undo/Redo command pattern.
