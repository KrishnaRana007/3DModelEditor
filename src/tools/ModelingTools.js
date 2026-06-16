/**
 * Modeling tool module boundary.
 *
 * Extrude, Bevel, Chamfer, Multicut and Mirror implementations should be moved
 * here incrementally. For v21 the public registry and folder are established
 * without changing the tested tool behavior from main.js.
 */
export class ModelingTools {
  constructor({ settings }) {
    this.settings = settings;
  }

  getExtrudeSettings() {
    return this.settings?.extrude || null;
  }
}
