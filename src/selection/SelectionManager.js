/**
 * SelectionManager defines the selection state contract.
 *
 * Future refactor target: move selectedObjects, selectedFaces, selectedEdges,
 * selectedVertices and hover state out of main.js into this class.
 */
export class SelectionManager {
  constructor() {
    this.objects = [];
    this.faces = [];
    this.edges = [];
    this.vertices = [];
    this.mode = 'object';
  }

  clear() {
    this.objects.length = 0;
    this.faces.length = 0;
    this.edges.length = 0;
    this.vertices.length = 0;
  }

  setMode(mode) {
    this.mode = mode;
  }
}
