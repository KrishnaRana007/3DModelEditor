# 3D Model Editor v25

## Import / Export 3D Models

Added model import/export support to make the editor usable with external 3D assets.

### Import formats
- OBJ
- GLTF / GLB
- STL

### Export formats
- OBJ
- GLTF
- GLB
- STL

### Implementation notes
- Added `src/io/ModelIOManager.js` for model-specific import/export code.
- File menu now contains separate Project I/O and Model I/O actions.
- Imported mesh objects are registered into the editor scene hierarchy and can be selected, transformed, material-edited, animated, and saved with the custom project JSON/XML system.
- Export uses selected meshes when available; otherwise it exports all editable mesh objects in the scene.
