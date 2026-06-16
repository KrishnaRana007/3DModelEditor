# 3D Model Editor v6 - Select Tool, Object/Light Menus, Undo/Redo

## Added
- Renamed the old Selection > Box tool to **Select**.
- Select tool is active by default and hides TransformControls while selecting.
- Selected mesh objects show a blue wireframe overlay when Select is active.
- Added an **Object** menu button in the left Tools panel.
  - Click Object to show Cube, Sphere, Plane, Cylinder, Cone.
  - Choosing a primitive adds it to the scene.
- Added a **Light** menu button in the left Tools panel.
  - Click Light to show Directional, Point, Ambient lights.
  - Choosing a light adds it to the scene.
- Added command-pattern Undo/Redo support.
  - Undo / Redo buttons in the top bar.
  - Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z.
  - Commands currently cover add object/light, delete selected object(s), object transform, and face/vertex geometry transform.

## Preserved
- Fully offline local Three.js setup.
- Default cube at scene origin.
- Alt + mouse OrbitControls.
- Rectangle selection without Ctrl.
- Shift + click multi-selection.
- Object, Face, and Vertex edit modes from the viewport context menu.
- Triangulated face selection and welded/attached face movement behavior.
- Draggable/resizable editor partitions.
