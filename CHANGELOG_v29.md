# 3D Model Editor v29

## Grid and Measurement Tools

Added a new Grid / Measurement tool compatible with the existing editor structure.

### Added
- Configurable grid size.
- Configurable grid divisions.
- Unit system selector:
  - Meters
  - Centimeters
  - Millimeters
  - Inches
  - Feet
- Ruler tool.
- Distance measurement.
- Angle measurement.
- Measurement overlays with point markers, lines, and viewport labels.
- Clear Measurements action.

### Access
- Top Tools menu → Grid / Measurement.
- Viewport right-click context menu → Grid / Measurement.
- Bottom Properties tab contains all grid/measurement properties.

### Structure
- Added `src/tools/GridMeasurementTools.js` for grid sizing and measurement overlay logic.
