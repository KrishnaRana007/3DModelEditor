// Animation timeline utilities kept separate from the main editor file.
// They manage the visible frame range, pointer-to-frame conversion, and playhead syncing.

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function getStableAnimationVisibleRange(animationState) {
  const minFrames = 12;
  const totalFrames = Math.max(1, Number(animationState.totalFrames) || 120);
  const zoomT = clamp(animationState.zoom, 0, 100) / 100;
  const visibleCount = Math.max(1, Math.round(totalFrames + (minFrames - totalFrames) * zoomT));
  const maxStart = Math.max(0, totalFrames - visibleCount);

  let start = clamp(animationState.viewStart ?? 0, 0, maxStart);
  const current = clamp(animationState.currentFrame ?? 0, 0, totalFrames);

  // Keep the viewport stable while the playhead is inside the visible range.
  // Only scroll the timeline window when playback/scrubbing reaches an edge.
  if (current < start) start = Math.max(0, Math.floor(current));
  if (current > start + visibleCount) start = Math.min(maxStart, Math.ceil(current - visibleCount));

  animationState.viewStart = start;
  const end = Math.min(totalFrames, start + visibleCount);
  return { start, end, visibleCount: Math.max(1, end - start) };
}

export function frameFromTimelinePointer(event, animationState, visibleRange) {
  const { start, end } = visibleRange;
  const ui = animationState.ui || {};
  const target = event.target;
  const lane = target?.closest?.('.animation-track-lane, .animation-ruler');
  let rect = lane?.getBoundingClientRect?.();
  let x = 0;
  let width = 1;

  if (rect) {
    x = event.clientX - rect.left;
    width = Math.max(1, rect.width);
  } else if (ui.timeline) {
    const timelineRect = ui.timeline.getBoundingClientRect();
    const labelWidth = 150;
    x = event.clientX - timelineRect.left - labelWidth;
    width = Math.max(1, timelineRect.width - labelWidth);
  }

  const t = clamp(x / width, 0, 1);
  return Math.round(start + (end - start) * t);
}

export function syncAnimationPlayheads(animationState, visibleRange) {
  const ui = animationState.ui || {};
  const timeline = ui.timeline;
  if (!timeline) return;

  const { start, end } = visibleRange;
  const frame = clamp(animationState.currentFrame ?? 0, 0, animationState.totalFrames ?? 120);
  const percent = clamp((frame - start) / Math.max(1, end - start), 0, 1) * 100;

  timeline.querySelectorAll('[data-anim-playhead]').forEach(el => {
    el.style.left = `${percent}%`;
  });

  if (ui.frameNumber) {
    ui.frameNumber.value = String(Math.round(frame));
  }
}
