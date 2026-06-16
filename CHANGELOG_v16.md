# 3D Model Editor v16

## Extrude Combine logic fixed

- Fixed Combine behavior for Face extrusion.
- Combine checked:
  - selected faces that share a real edge are grouped and extruded as one combined region.
  - selected faces that do not share an edge remain separate.
- Combine unchecked:
  - every selected Face / Edge / Vertex extrudes independently, even if adjacent.
- Existing Extrude Amount X/Y/Z and gizmo synchronization are preserved.
