# 3D Model Editor v10 - Bottom Tabs and Context Menu Stability

## Changes
- Removed the left-side Tools panel from the workspace so the viewport starts at the left edge.
- Moved creation controls into the top Create menu and viewport context Create submenu.
- Kept Select, Move, Rotate, Scale, Extrude, Bevel, Chamfer, Multicut, and Mirror inside the top Tools menu and viewport context menu.
- Reworked the bottom section into tabs:
  - Inspector is active by default.
  - Material Asset edits selected mesh material properties.
  - Properties shows active modeling/transform tool settings.
- Added editable material fields for name, base color, roughness, metalness, opacity, wireframe, transparent, and render side.
- Added tool-property values for Extrude amount, Bevel amount, Chamfer amount, Multicut mode, and Mirror axis.
- Fixed the viewport context submenu hover gap so Mode and Mirror submenus do not disappear before clicking.

## Preserved
- Offline Three.js setup.
- Default cube at origin.
- Alt + mouse orbit.
- Rectangle selection and Shift + click multi-selection.
- Object, Face, Edge, and Vertex modes.
- Hover and selected component highlights.
- Command-pattern Undo/Redo.
