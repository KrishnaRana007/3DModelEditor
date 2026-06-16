# v5 Changelog

## Fixed as requested

1. OrbitControls are now controlled only by `Alt + mouse drag`.
2. Normal mouse drag in the viewport performs rectangle selection without pressing Ctrl.
3. `Shift + click` and `Shift + drag rectangle` add to the current selection.
4. Face Mode now selects the exact triangulated Three.js face instead of a whole coplanar face group.
5. Moving selected triangulated faces with TransformControls keeps coincident/split vertices welded to the object so the face does not detach from the original mesh.
6. Offline/local library setup is preserved. No CDN or online library link is used.

## Quick controls

- `Alt + mouse drag`: orbit scene camera.
- Click: select one item in the current mode.
- `Shift + click`: add/remove from selection.
- Drag in viewport: rectangle select.
- `Shift + drag`: additive rectangle select.
- Right-click viewport → Mode → Object / Face / Vertex.
