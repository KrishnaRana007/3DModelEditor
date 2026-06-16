/**
 * MouseEventManager is the home for viewport mouse/pointer handling.
 *
 * The current editor runtime still binds many legacy handlers from main.js to
 * preserve behavior. New pointer behavior should be routed through this class:
 * - viewport click/shift-click selection
 * - rectangle selection drag
 * - context menu opening
 * - Alt-orbit/pan/zoom coordination
 */
export class MouseEventManager {
  constructor({ domElement, handlers = {} } = {}) {
    this.domElement = domElement;
    this.handlers = handlers;
    this.unbinders = [];
  }

  on(target, eventName, handler, options) {
    if (!target || !handler) return;
    target.addEventListener(eventName, handler, options);
    this.unbinders.push(() => target.removeEventListener(eventName, handler, options));
  }

  dispose() {
    for (const unbind of this.unbinders.splice(0)) unbind();
  }
}
