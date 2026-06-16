# 3D Model Editor v22

## Basic tool expansion

Added compatible starter implementations for:

1. Delete Tool
   - Deletes selected objects.
   - Deletes selected Face/Edge/Vertex components by removing affected triangles.

2. Duplicate Tool
   - Duplicates selected objects.
   - Duplicates selected component geometry into a new mesh object.
   - Adds Ctrl+D shortcut.

3. Snap Tool
   - Grid snapping for object/component transforms.
   - Rotation and scale step properties.
   - Snaps on gizmo release when enabled.

4. Align Tool
   - Axis-based Min/Center/Max alignment for objects and components.

5. UV Mapping Tool
   - Box, Planar XY, Planar XZ, Cylindrical, and Spherical projections.
   - Repeat, offset, and rotation controls.

6. Texture Controls
   - Repeat, offset, rotation, wrap mode, and FlipY controls for uploaded textures.

7. Multi-material Face Assignment
   - Assigns a new material to selected faces in Face mode.

8. Array Tool
   - Linear and Circular arrays with count, offset/radius/axis/angle controls.

All tools are available from the top Tools menu and viewport context menu, and their essential properties are mapped in the bottom Properties tab.
