# 3D Model Editor v20

## Animation timeline smoothness
- Removed static playhead issue during scrubbing/playback.
- Seekbar/playhead now follows the mouse pointer while scrubbing the timeline.
- Seekbar/playhead now moves continuously during Play.
- Timeline visible range is now stable; it no longer re-centers every frame and prevents visual playhead movement.

## Codebase structure
- Created `src/` folder.
- Moved main editor runtime into `src/main.js`.
- Added `src/animationTimelineHelpers.js` for scrub/playhead utilities.
- Kept root `app.js` as a compatibility wrapper.
