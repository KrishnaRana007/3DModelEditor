# 3D Model Editor v11 - Restored Left Toolbar + Multi-row Icon Flyouts

## Changes

- Restored the left toolbar instead of removing it.
- Left toolbar now contains only the requested buttons:
  - Select
  - Translate gizmo
  - Scale gizmo
  - Rotate gizmo
  - Object
  - Light
- Object and Light menus now open as right-side floating flyouts beside the left toolbar.
- Object and Light options are arranged in a multi-row responsive grid instead of one long row/list.
- Added icon-style visual labels to every left-toolbar button and every Object/Light flyout option.
- Expanded Object menu to include the practical Three.js geometry objects supported in this editor:
  - Box/Cube, Sphere, Plane, Cylinder, Cone, Capsule, Circle, Ring, Torus, Torus Knot, Dodecahedron, Icosahedron, Octahedron, Tetrahedron, Lathe, Tube, Shape, Extrude Shape.
- Expanded Light menu to include core Three.js light types:
  - Ambient, Directional, Hemisphere, Point, Spot, Rect Area.
- Kept bottom tabs from v10:
  - Inspector
  - Material Asset
  - Properties
- Preserved context-menu submenu stability from v10.
- Preserved offline local Three.js setup.

## Regression-sensitive behavior preserved

- Default cube at origin.
- Alt + mouse orbit.
- Rectangle selection without Ctrl.
- Shift + click multi-selection.
- Object / Face / Edge / Vertex modes.
- Hover and selected component highlights.
- Modeling tools and Undo/Redo command pattern.
