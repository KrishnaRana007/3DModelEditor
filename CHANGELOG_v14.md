# CHANGELOG v14 - Extrude Amount Properties Fix

## Fixed
- Replaced incompatible Extrude/Threshold property names with tool-compatible controls:
  - Extrude Amount X
  - Extrude Amount Y
  - Extrude Amount Z
- Each Extrude Amount control is clamped from -10 to 10.
- Extrude Amount properties now control the active extrusion after the Extrude tool is applied.
- Translate gizmo and Properties panel now work together for the same active extrusion:
  - Dragging the gizmo updates the X/Y/Z Extrude Amount values.
  - Editing X/Y/Z values moves the active extruded Face/Edge/Vertex selection.
- Kept the existing Extrude workflow unchanged: select Face/Edge/Vertex, run Extrude, then adjust using gizmo or properties.

## Preserved
- Offline Three.js setup.
- Default cube at origin.
- Left toolbar alignment and Object/Light flyouts.
- Bottom tabs, including Properties panel.
- Face/Edge/Vertex component selection and highlights.
- Undo/Redo command pattern.
