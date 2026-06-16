/**
 * Tool registry: object/light creation ids, labels and default tool settings.
 *
 * Add new primitives, lights and modeling-tool defaults here first. UI and
 * context-menu handlers should consume this registry instead of hardcoding ids.
 */
export const OBJECT_TYPES = new Set([
  'cube', 'sphere', 'plane', 'cylinder', 'cone', 'capsule', 'circle', 'ring',
  'torus', 'torusKnot', 'dodecahedron', 'icosahedron', 'octahedron',
  'tetrahedron', 'lathe', 'tube', 'shape', 'extrudeShape'
]);

export const LIGHT_TYPES = new Set([
  'ambientLight', 'directionalLight', 'hemisphereLight', 'pointLight', 'spotLight', 'rectAreaLight'
]);

export const CAMERA_TYPES = new Set([
  'perspectiveCamera', 'orthographicCamera'
]);

export const ADD_LABELS = {
  cube: 'Box / Cube', sphere: 'Sphere', plane: 'Plane', cylinder: 'Cylinder', cone: 'Cone',
  capsule: 'Capsule', circle: 'Circle', ring: 'Ring', torus: 'Torus', torusKnot: 'Torus Knot',
  dodecahedron: 'Dodecahedron', icosahedron: 'Icosahedron', octahedron: 'Octahedron',
  tetrahedron: 'Tetrahedron', lathe: 'Lathe', tube: 'Tube', shape: 'Shape', extrudeShape: 'Extrude Shape',
  ambientLight: 'Ambient Light', directionalLight: 'Directional Light', hemisphereLight: 'Hemisphere Light',
  pointLight: 'Point Light', spotLight: 'Spot Light', rectAreaLight: 'Rect Area Light',
  perspectiveCamera: 'Perspective Camera', orthographicCamera: 'Orthographic Camera'
};

export const DEFAULT_MODELING_TOOL_SETTINGS = {
  extrude: { amountX: 0, amountY: 0, amountZ: 0, combine: false },
  bevel: { amount: 0.08 },
  chamfer: { amount: 0.14 },
  multicut: { mode: 'center-split' },
  mirror: { axis: 'x' },
  delete: { mode: 'selection' },
  duplicate: { offsetX: 0.45, offsetY: 0, offsetZ: 0.45 },
  snap: { enabled: false, target: 'grid', gridSize: 1, rotationStep: 15, scaleStep: 0.1 },
  align: { axis: 'x', alignTo: 'center', target: 'selection' },
  uvMapping: { projection: 'box', repeatU: 1, repeatV: 1, offsetU: 0, offsetV: 0, rotation: 0 },
  textureControls: { repeatU: 1, repeatV: 1, offsetU: 0, offsetV: 0, rotation: 0, wrap: 'RepeatWrapping', flipY: true },
  multiMaterial: { color: '#ff8f00', materialType: 'MeshStandardMaterial', materialName: 'Face Material' },
  array: { mode: 'linear', count: 3, offsetX: 1.25, offsetY: 0, offsetZ: 0, axis: 'y', radius: 2, angle: 360, includeOriginal: true },
  gridMeasure: { gridSize: 20, gridDivisions: 20, unitSystem: 'meter', mode: 'distance' },
  select: {},
  translate: {},
  rotate: {},
  scale: {}
};

export class ToolRegistry {
  constructor() {
    this.objectTypes = OBJECT_TYPES;
    this.lightTypes = LIGHT_TYPES;
    this.cameraTypes = CAMERA_TYPES;
    this.labels = ADD_LABELS;
    this.defaultSettings = DEFAULT_MODELING_TOOL_SETTINGS;
  }

  isObjectType(type) {
    return this.objectTypes.has(type);
  }

  isLightType(type) {
    return this.lightTypes.has(type);
  }

  isCameraType(type) {
    return this.cameraTypes.has(type);
  }

  labelFor(type) {
    return this.labels[type] || type;
  }
}
