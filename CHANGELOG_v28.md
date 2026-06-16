# 3D Model Editor v28

## View Modes
Added viewport display modes under the **View** menu and viewport context menu.

### Added modes
- Solid View
- Wireframe View
- Material Preview
- Rendered Preview
- X-Ray Mode
- Normal View
- UV View

### Notes
- View modes are display-only and do not permanently change the real object material.
- Material/project save and model export continue to use the real assigned material, not the temporary view-mode override.
- UV View auto-generates a temporary planar UV attribute for meshes that do not already have UV data.
