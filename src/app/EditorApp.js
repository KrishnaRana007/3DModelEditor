import * as THREE from 'three';
import { getDomRefs } from '../core/DomRefs.js';
import { createSceneManager } from '../core/SceneManager.js';
import { AssetManager, MATERIAL_TYPES, materialTypeLabel } from '../assets/AssetManager.js';
import { OBJECT_TYPES, LIGHT_TYPES, CAMERA_TYPES, ADD_LABELS, DEFAULT_MODELING_TOOL_SETTINGS, ToolRegistry } from '../tools/ToolRegistry.js';
import { getStableAnimationVisibleRange, frameFromTimelinePointer, syncAnimationPlayheads } from '../animation/AnimationTimelineHelpers.js';
import { downloadTextFile, readTextFile, projectJsonToXml, projectXmlToJson } from '../io/ProjectIOManager.js';
import { downloadBlob, importModelFileToObject, exportOBJ, exportSTL, exportGLTFText, exportGLBBlob } from '../io/ModelIOManager.js';
import { ViewModeManager } from '../view/ViewModeManager.js';
import { GridMeasurementManager } from '../tools/GridMeasurementTools.js';
import { HistoryPanelManager } from '../ui/HistoryPanelManager.js';

const dom = getDomRefs();
const {
  viewport, viewportHelp, selectionRect, editorContextMenu, sceneTree,
  inspectorContent, materialAssetContent, toolPropertiesContent, animationContent, historyContent,
  selectedBadge, toolsPanel, hierarchyPanel, inspectorPanel, undoBtn, redoBtn,
  resetViewBtn, clearSelectionBtn, deleteBtn, selectToolBtn, objectMenuBtn,
  lightMenuBtn, cameraMenuBtn, objectOptions, lightOptions, cameraOptions, cameraFrameOverlay, cameraViewBadge, toolsMenuBtn, viewMenuBtn, viewMenuDropdown, toolsMenuDropdown,
  fileMenuBtn, fileMenuDropdown, projectFileInput, modelFileInput, createMenuBtn, createMenuDropdown, guideBtn, guideModal, guideCloseBtn
} = dom;

const sceneManager = createSceneManager({ viewport });
const {
  renderer, scene, camera, orbit, transform, selectionPivot,
  componentOverlayGroup, componentHoverOverlayGroup, objectWireOverlayGroup,
  objectWireMaterial, faceOverlayMaterial, faceHoverMaterial,
  edgeOverlayMaterial, edgeHoverMaterial, vertexOverlayMaterial, vertexHoverMaterial,
  vertexOverlayGeometry, vertexHoverGeometry, grid, axes
} = sceneManager;

const assetManager = new AssetManager();
const toolRegistry = new ToolRegistry();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selectableObjects = [];
const selectedObjects = [];
const selectedFaces = [];
const selectedEdges = [];
const selectedVertices = [];
let hoveredFace = null;
let hoveredEdge = null;
let hoveredVertex = null;
const editorObjects = new Map();
let objectIndex = 1;
let currentTransformMode = 'translate';
let editMode = 'object';
let selectTool = 'select';
let multiDragState = null;
let componentDragState = null;
let ignoreNextCanvasClick = false;
let idCounter = 1;
let boxDragState = null;
let activePropertiesTool = 'select';
let activeExtrudeSession = null;
let activeCameraViewObject = null;
let activeViewMode = 'material';
const modelingToolSettings = structuredClone(DEFAULT_MODELING_TOOL_SETTINGS);


const viewModeManager = new ViewModeManager({
  scene,
  renderer,
  getMeshObjects: () => [...editorObjects.values()].filter(object => object?.isMesh && object.parent && !object.userData?.internal),
  notify
});

const gridMeasurementManager = new GridMeasurementManager({
  scene,
  baseGrid: grid,
  notify
});

const historyPanelManager = new HistoryPanelManager({ container: historyContent });

function syncGridMeasurementSettings() {
  const settings = modelingToolSettings.gridMeasure || {};
  gridMeasurementManager.applyGridSettings({
    gridSize: Number(settings.gridSize) || 20,
    gridDivisions: Number(settings.gridDivisions) || 20,
    unitSystem: settings.unitSystem || 'meter',
    mode: settings.mode || 'distance'
  });
  gridMeasurementManager.setMode(settings.mode || 'distance');
}

function updateViewModeButtons() {
  document.querySelectorAll('[data-view-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.viewMode === activeViewMode);
  });
}

function setViewMode(mode) {
  activeViewMode = mode || 'material';
  viewModeManager.setMode(activeViewMode);
  updateViewModeButtons();
  updateSelectionState();
}


const animationState = {
  currentFrame: 0,
  totalFrames: 120,
  fps: 24,
  speed: 1,
  zoom: 45,
  playing: false,
  autoKey: true,
  applying: false,
  lastTimestamp: null,
  timelineScrubbing: false,
  tracks: new Map(),
  baselines: new Map(),
  uiBuilt: false,
  ui: {}
};

const DOPESHEET_ROWS = [
  { id: 'position', label: 'Position', icon: '↕', available: state => !!state?.position },
  { id: 'rotation', label: 'Rotation', icon: '⟳', available: state => !!state?.rotation },
  { id: 'scale', label: 'Scale', icon: '□', available: state => !!state?.scale },
  { id: 'materialColor', label: 'Material Color', icon: '●', available: state => state?.material?.color != null },
  { id: 'opacity', label: 'Opacity', icon: '◐', available: state => state?.material?.opacity != null }
];

const tmpBox = new THREE.Box3();
const tmpCenter = new THREE.Vector3();
const tmpVec2A = new THREE.Vector2();
const tmpVec2B = new THREE.Vector2();
const tmpVec3A = new THREE.Vector3();
const tmpVec3B = new THREE.Vector3();
const tmpVec3C = new THREE.Vector3();
const tmpVec3D = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();

class CommandManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  execute(command) {
    if (!command) return;
    command.execute();
    this.undoStack.push(command);
    this.redoStack.length = 0;
    updateUndoRedoUI();
  }

  record(command) {
    if (!command || (typeof command.hasChanges === 'function' && !command.hasChanges())) return;
    this.undoStack.push(command);
    this.redoStack.length = 0;
    updateUndoRedoUI();
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
    updateUndoRedoUI();
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return;
    command.execute();
    this.undoStack.push(command);
    updateUndoRedoUI();
  }
}

class AddObjectCommand {
  constructor(label, factory) {
    this.label = label;
    this.factory = factory;
    this.sceneItem = null;
  }

  execute() {
    if (!this.sceneItem) this.sceneItem = this.factory();
    addObjectToScene(this.sceneItem.object, this.sceneItem.type, this.sceneItem.options || {});
  }

  undo() {
    if (!this.sceneItem) return;
    removeObjectFromEditor(this.sceneItem.object, { dispose: false });
    clearAllSelections();
  }
}

class AddMultipleObjectsCommand {
  constructor(label, sceneItems) {
    this.label = label;
    this.sceneItems = sceneItems || [];
  }

  execute() {
    const added = [];
    for (const item of this.sceneItems) {
      if (!item?.object) continue;
      addObjectToScene(item.object, item.type || item.object.userData.editorType || item.object.type, item.options || {});
      added.push(item.object);
    }
    if (added.length) {
      setEditMode('object', { keepSelection: true });
      selectObjects(added);
    }
  }

  undo() {
    for (const item of this.sceneItems) {
      if (item?.object) removeObjectFromEditor(item.object, { dispose: false });
    }
    clearAllSelections();
  }
}


class ImportModelCommand {
  constructor(root, label = 'Import Model') {
    this.root = root;
    this.label = label;
    this.registered = [];
  }

  execute() {
    if (!this.root) return;
    if (!this.root.parent) scene.add(this.root);
    this.registered.length = 0;
    this.root.updateMatrixWorld?.(true);
    this.root.traverse(child => {
      if (!child.isMesh && !child.isLight) return;
      child.castShadow = child.isMesh ? true : child.castShadow;
      child.receiveShadow = child.isMesh ? true : child.receiveShadow;
      registerEditorObject(child, child.isMesh ? 'Imported Mesh' : 'Imported Light');
      this.registered.push(child);
    });
    if (!this.registered.length) {
      registerEditorObject(this.root, this.root.type || 'Imported Object');
      this.registered.push(this.root);
    }
    setEditMode('object', { keepSelection: true });
    selectObjects([this.registered[0]]);
    refreshSceneTree();
    refreshInspector();
  }

  undo() {
    clearAllSelections();
    for (const object of this.registered) {
      const index = selectableObjects.indexOf(object);
      if (index >= 0) selectableObjects.splice(index, 1);
      if (object.userData?.editorId) editorObjects.delete(object.userData.editorId);
    }
    if (this.root.parent) this.root.parent.remove(this.root);
    refreshSceneTree();
    refreshInspector();
  }
}

class DeleteObjectsCommand {
  constructor(objects) {
    this.objects = objects.map(object => ({ object, parent: object.parent || scene }));
  }

  execute() {
    clearAllSelections();
    for (const item of this.objects) removeObjectFromEditor(item.object, { dispose: false });
    refreshSceneTree();
    refreshInspector();
  }

  undo() {
    const restored = [];
    for (const item of this.objects) {
      const parent = item.parent || scene;
      parent.add(item.object);
      registerEditorObject(item.object, item.object.userData.editorType || item.object.type);
      restored.push(item.object);
    }
    setEditMode('object', { keepSelection: true });
    selectObjects(restored);
  }
}

class RenameObjectCommand {
  constructor(object, nextName) {
    this.object = object;
    this.before = object?.name || '';
    this.after = String(nextName || '').trim() || this.before;
  }
  execute() {
    if (!this.object) return;
    this.object.name = this.after;
    refreshSceneTree();
    refreshInspector();
  }
  undo() {
    if (!this.object) return;
    this.object.name = this.before;
    refreshSceneTree();
    refreshInspector();
  }
  hasChanges() { return this.before !== this.after; }
}

class ObjectVisibilityCommand {
  constructor(object, nextVisible) {
    this.object = object;
    this.before = object?.visible !== false;
    this.after = Boolean(nextVisible);
  }
  execute() {
    if (!this.object) return;
    this.object.visible = this.after;
    refreshSceneTree();
    refreshInspector();
  }
  undo() {
    if (!this.object) return;
    this.object.visible = this.before;
    refreshSceneTree();
    refreshInspector();
  }
  hasChanges() { return this.before !== this.after; }
}

class ObjectLockCommand {
  constructor(object, nextLocked) {
    this.object = object;
    this.before = !!object?.userData?.locked;
    this.after = Boolean(nextLocked);
  }
  execute() {
    if (!this.object) return;
    this.object.userData.locked = this.after;
    if (this.after) {
      selectedObjects.splice(0, selectedObjects.length, ...selectedObjects.filter(item => item !== this.object && !hasEditorAncestor(item, this.object)));
      updateSelectionState();
    }
    refreshSceneTree();
    refreshInspector();
  }
  undo() {
    if (!this.object) return;
    this.object.userData.locked = this.before;
    refreshSceneTree();
    refreshInspector();
  }
  hasChanges() { return this.before !== this.after; }
}

class ParentObjectCommand {
  constructor(child, nextParent) {
    this.child = child;
    this.beforeParent = child?.parent || scene;
    this.afterParent = nextParent || scene;
  }
  execute() {
    if (!canParentObject(this.child, this.afterParent === scene ? null : this.afterParent)) return;
    attachPreserveWorld(this.afterParent, this.child);
    refreshSceneTree();
    refreshInspector();
  }
  undo() {
    attachPreserveWorld(this.beforeParent, this.child);
    refreshSceneTree();
    refreshInspector();
  }
  hasChanges() { return this.beforeParent !== this.afterParent; }
}


class MaterialAssetCommand {
  constructor(object, beforeMaterial, afterMaterial, label = 'Apply Material') {
    this.object = object;
    this.before = beforeMaterial?.clone?.() || beforeMaterial || null;
    this.after = afterMaterial?.clone?.() || afterMaterial || null;
    this.label = label;
  }

  apply(material) {
    if (!this.object || !material) return;
    const previous = this.object.material;
    this.object.material = material.clone?.() || material;
    previous?.dispose?.();
    refreshObjectWireOverlays();
    refreshComponentOverlays();
    refreshInspector(false);
    refreshMaterialAsset();
  }

  execute() { this.apply(this.after); }
  undo() { this.apply(this.before); }
}

class AnimationKeysCommand {
  constructor(before, after, label = 'Add Keyframe') {
    this.before = before;
    this.after = after;
    this.label = label;
  }

  execute() {
    applyAnimationKeySnapshot(this.after);
    refreshAnimationPanel(false);
  }

  undo() {
    applyAnimationKeySnapshot(this.before);
    refreshAnimationPanel(false);
  }

  hasChanges() {
    return JSON.stringify(this.before) !== JSON.stringify(this.after);
  }
}

class ObjectTransformCommand {
  constructor(before, after) {
    this.before = before;
    this.after = after;
  }

  execute() {
    applyObjectTransformStates(this.after);
  }

  undo() {
    applyObjectTransformStates(this.before);
  }

  hasChanges() {
    return transformStatesDiffer(this.before, this.after);
  }
}

class ComponentGeometryCommand {
  constructor(before, after) {
    this.before = before;
    this.after = after;
  }

  execute() {
    applyGeometryPositionStates(this.after);
  }

  undo() {
    applyGeometryPositionStates(this.before);
  }

  hasChanges() {
    return geometryStatesDiffer(this.before, this.after);
  }
}

class GeometryReplaceCommand {
  constructor(label, before, after, nextMode = null) {
    this.label = label;
    this.before = before;
    this.after = after;
    this.nextMode = nextMode;
  }

  execute() {
    applyGeometryCloneStates(this.after);
    clearAllSelections();
    if (this.nextMode) setEditMode(this.nextMode, { keepSelection: true });
  }

  undo() {
    applyGeometryCloneStates(this.before);
    clearAllSelections();
    if (this.nextMode) setEditMode(this.nextMode, { keepSelection: true });
  }

  hasChanges() {
    return geometryCloneStatesDiffer(this.before, this.after);
  }
}

const commandManager = new CommandManager();
let pendingTransformCommand = null;

function jumpHistoryToPosition(targetPosition) {
  const total = commandManager.undoStack.length + commandManager.redoStack.length;
  const target = Math.max(0, Math.min(total, Math.round(Number(targetPosition) || 0)));
  while (commandManager.undoStack.length > target) commandManager.undo();
  while (commandManager.undoStack.length < target) commandManager.redo();
  refreshInspector(false);
  refreshMaterialAsset?.(false);
  refreshAnimationPanel?.(false);
}

function renderHistoryPanel() {
  historyPanelManager.render(commandManager, jumpHistoryToPosition);
}

function updateUndoRedoUI() {
  if (undoBtn) undoBtn.disabled = commandManager.undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = commandManager.redoStack.length === 0;
  renderHistoryPanel();
}

function makeEditorId() {
  return `editor-object-${idCounter++}`;
}

function randomNearOrigin() {
  const spread = 2.2;
  return new THREE.Vector3(
    (Math.random() - 0.5) * spread,
    0.5,
    (Math.random() - 0.5) * spread
  );
}

function registerEditorObject(object, type) {
  if (!object) return object;
  const registerOne = (target, fallbackType) => {
    if (!target.userData) target.userData = {};
    if (target.userData.internal) {
      if (target.userData?.helperFor && !selectableObjects.includes(target)) selectableObjects.push(target);
      return;
    }
    if (!target.userData.editorId) target.userData.editorId = makeEditorId();
    target.userData.editorType = target.userData.editorType || fallbackType || target.type || 'Object3D';
    editorObjects.set(target.userData.editorId, target);
    if ((target.isMesh || target.isLight || target.isObject3D) && !selectableObjects.includes(target)) selectableObjects.push(target);
  };

  registerOne(object, type);
  object.traverse(child => {
    if (child === object) return;
    if (child.userData?.helperFor && !selectableObjects.includes(child)) {
      selectableObjects.push(child);
      return;
    }
    if (child.userData?.internal) return;
    if (child.isMesh || child.isLight || child.userData?.editorId) registerOne(child, child.userData?.editorType || child.type);
  });
  return object;
}

function markEditorObject(object, type) {
  return registerEditorObject(object, type);
}

function removeObjectFromEditor(object, options = {}) {
  if (!object) return;
  const { dispose = false } = options;
  const removable = [];
  object.traverse(child => removable.push(child));
  for (const child of removable) {
    const index = selectableObjects.indexOf(child);
    if (index >= 0) selectableObjects.splice(index, 1);
    if (child.userData?.editorId) editorObjects.delete(child.userData.editorId);
  }
  if (object.parent) object.parent.remove(object);
  if (dispose) {
    object.traverse(child => {
      if (child.geometry && child.geometry !== vertexOverlayGeometry) child.geometry.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose?.());
        else child.material.dispose?.();
      }
    });
  }
  selectedObjects.splice(0, selectedObjects.length, ...selectedObjects.filter(item => !removable.includes(item)));
  if (removable.includes(activeCameraViewObject)) {
    setCameraObjectHelpersVisible(activeCameraViewObject, true);
    activeCameraViewObject = null;
    updateCameraFrameOverlay();
  }
  refreshObjectWireOverlays();
}

function addObjectToScene(object, type, options = {}) {
  registerEditorObject(object, type);
  object.name = options.name || object.name || `${type} ${objectIndex++}`;
  if (options.position) object.position.copy(options.position);
  object.castShadow = true;
  object.receiveShadow = true;
  object.traverse(child => {
    if (child !== object && child.userData?.internal) child.userData.helperFor = object.userData.editorId;
    if (child.userData?.helperFor && !selectableObjects.includes(child)) selectableObjects.push(child);
  });
  if (!object.parent) scene.add(object);
  setEditMode('object', { keepSelection: true });
  selectObjects([object]);
  refreshSceneTree();
  refreshInspector();
  return object;
}

function materialSupportsTexture(material) {
  return material && 'map' in material;
}

function createMaterialByType(type = 'MeshStandardMaterial', options = {}) {
  const color = options.color ?? 0x7db5ff;
  const common = {
    side: options.side ?? THREE.FrontSide,
    transparent: Boolean(options.transparent),
    opacity: options.opacity ?? 1
  };

  let material;
  switch (type) {
    case 'MeshBasicMaterial':
      material = new THREE.MeshBasicMaterial({ ...common, color });
      break;
    case 'MeshLambertMaterial':
      material = new THREE.MeshLambertMaterial({ ...common, color, emissive: 0x000000 });
      break;
    case 'MeshPhongMaterial':
      material = new THREE.MeshPhongMaterial({ ...common, color, specular: 0x888888, shininess: 45 });
      break;
    case 'MeshPhysicalMaterial':
      material = new THREE.MeshPhysicalMaterial({
        ...common,
        color,
        roughness: 0.28,
        metalness: 0.08,
        clearcoat: 0.65,
        clearcoatRoughness: 0.12,
        reflectivity: 0.55
      });
      break;
    case 'MeshToonMaterial':
      material = new THREE.MeshToonMaterial({ ...common, color });
      break;
    case 'MeshMatcapMaterial':
      material = new THREE.MeshMatcapMaterial({ ...common, color });
      break;
    case 'MeshNormalMaterial':
      material = new THREE.MeshNormalMaterial({ ...common, flatShading: false });
      break;
    case 'MeshDepthMaterial':
      material = new THREE.MeshDepthMaterial({ ...common });
      break;
    case 'MeshDistanceMaterial':
      material = new THREE.MeshDistanceMaterial({ ...common });
      break;
    case 'ShadowMaterial':
      material = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.35, transparent: true, side: common.side });
      break;
    case 'MeshStandardMaterial':
    default:
      material = new THREE.MeshStandardMaterial({ ...common, color, roughness: 0.42, metalness: 0.16 });
      break;
  }

  material.name = options.name || materialTypeLabel(material.type || type);
  if (options.map && materialSupportsTexture(material)) {
    material.map = options.map;
    if (material.color) material.color.set(0xffffff);
  }
  material.needsUpdate = true;
  return material;
}

function createMaterial(color = 0x7db5ff) {
  return createMaterialByType('MeshStandardMaterial', { color, name: 'Standard Material' });
}

function makeSimpleShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.55, -0.45);
  shape.lineTo(0.48, -0.45);
  shape.quadraticCurveTo(0.72, -0.18, 0.46, 0.06);
  shape.lineTo(0.12, 0.43);
  shape.lineTo(-0.48, 0.34);
  shape.quadraticCurveTo(-0.72, -0.08, -0.55, -0.45);
  return shape;
}

function buildMeshItem(kind, options = {}) {
  let geometry;
  let y = 0.5;
  let rotateFlatToGround = false;
  switch (kind) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.65, 32, 20);
      y = 0.65;
      break;
    case 'plane':
      geometry = new THREE.PlaneGeometry(2, 2);
      y = 0.01;
      rotateFlatToGround = true;
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 32);
      y = 0.6;
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(0.65, 1.3, 32);
      y = 0.65;
      break;
    case 'capsule':
      geometry = new THREE.CapsuleGeometry(0.36, 0.82, 8, 18);
      y = 0.77;
      break;
    case 'circle':
      geometry = new THREE.CircleGeometry(0.82, 48);
      y = 0.012;
      rotateFlatToGround = true;
      break;
    case 'ring':
      geometry = new THREE.RingGeometry(0.42, 0.82, 64);
      y = 0.014;
      rotateFlatToGround = true;
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(0.56, 0.18, 18, 72);
      y = 0.62;
      break;
    case 'torusKnot':
      geometry = new THREE.TorusKnotGeometry(0.46, 0.13, 96, 14);
      y = 0.65;
      break;
    case 'dodecahedron':
      geometry = new THREE.DodecahedronGeometry(0.75, 0);
      y = 0.75;
      break;
    case 'icosahedron':
      geometry = new THREE.IcosahedronGeometry(0.75, 0);
      y = 0.75;
      break;
    case 'octahedron':
      geometry = new THREE.OctahedronGeometry(0.78, 0);
      y = 0.78;
      break;
    case 'tetrahedron':
      geometry = new THREE.TetrahedronGeometry(0.82, 0);
      y = 0.82;
      break;
    case 'lathe': {
      const points = [];
      for (let i = 0; i < 10; i++) {
        const t = i / 9;
        const radius = 0.18 + Math.sin(t * Math.PI) * 0.38 + (t > 0.72 ? 0.14 : 0);
        points.push(new THREE.Vector2(radius, (t - 0.5) * 1.55));
      }
      geometry = new THREE.LatheGeometry(points, 40);
      y = 0.82;
      break;
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.9, 0.0, -0.25),
        new THREE.Vector3(-0.3, 0.45, 0.25),
        new THREE.Vector3(0.25, 0.1, -0.25),
        new THREE.Vector3(0.9, 0.55, 0.2)
      ]);
      geometry = new THREE.TubeGeometry(curve, 48, 0.11, 14, false);
      y = 0.35;
      break;
    }
    case 'shape':
      geometry = new THREE.ShapeGeometry(makeSimpleShape(), 18);
      y = 0.018;
      rotateFlatToGround = true;
      break;
    case 'extrudeShape':
      geometry = new THREE.ExtrudeGeometry(makeSimpleShape(), {
        depth: 0.32,
        bevelEnabled: true,
        bevelThickness: 0.035,
        bevelSize: 0.035,
        bevelSegments: 2
      });
      geometry.center();
      y = 0.18;
      break;
    case 'cube':
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
      y = 0.5;
      break;
  }

  const mesh = new THREE.Mesh(geometry, createMaterial(options.color));
  if (rotateFlatToGround) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
  }
  const label = ADD_LABELS[kind] || kind.charAt(0).toUpperCase() + kind.slice(1);
  const pos = options.position || randomNearOrigin();
  return {
    object: mesh,
    type: label,
    options: {
      name: options.name || `${label} ${objectIndex++}`,
      position: new THREE.Vector3(pos.x, options.position ? pos.y : y, pos.z)
    }
  };
}

function createMesh(kind, options = {}) {
  const item = buildMeshItem(kind, options);
  return addObjectToScene(item.object, item.type, item.options);
}

function makeLightHelperMesh(kind, color = 0xffdd77) {
  let geometry;
  if (kind === 'rectAreaLight') geometry = new THREE.PlaneGeometry(0.58, 0.38);
  else if (kind === 'spotLight') geometry = new THREE.ConeGeometry(0.18, 0.34, 18);
  else geometry = new THREE.SphereGeometry(0.16, 16, 10);
  const helper = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, wireframe: kind === 'rectAreaLight' }));
  return helper;
}

function buildLightItem(kind) {
  let light;
  let helperMesh = null;
  let typeLabel = ADD_LABELS[kind] || 'Light';

  if (kind === 'directionalLight') {
    light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(3, 5, 3);
    light.castShadow = true;
    helperMesh = makeLightHelperMesh(kind, 0xffdd77);
  } else if (kind === 'hemisphereLight') {
    light = new THREE.HemisphereLight(0xffffff, 0x334466, 0.85);
    light.position.set(0, 3.5, 0);
    helperMesh = makeLightHelperMesh(kind, 0x9cc7ff);
  } else if (kind === 'pointLight') {
    light = new THREE.PointLight(0xffffff, 1.2, 16);
    light.position.set(-2, 3, 2);
    light.castShadow = true;
    helperMesh = makeLightHelperMesh(kind, 0xffee99);
  } else if (kind === 'spotLight') {
    light = new THREE.SpotLight(0xffffff, 1.4, 22, Math.PI / 6, 0.35, 1.0);
    light.position.set(-3, 4.5, 3);
    light.target.position.set(0, 0, 0);
    light.castShadow = true;
    helperMesh = makeLightHelperMesh(kind, 0xfff0a8);
  } else if (kind === 'rectAreaLight') {
    light = new THREE.RectAreaLight(0xffffff, 3.0, 2.0, 1.2);
    light.position.set(0, 3, 3);
    light.lookAt(0, 0, 0);
    helperMesh = makeLightHelperMesh(kind, 0xfff5b8);
  } else {
    light = new THREE.AmbientLight(0xffffff, 0.35);
    light.position.set(0, 3, 0);
    helperMesh = makeLightHelperMesh(kind, 0xbdd7ff);
  }

  light.name = `${typeLabel} ${objectIndex++}`;
  if (helperMesh) {
    helperMesh.name = `${light.name} Helper`;
    helperMesh.userData.internal = true;
    light.add(helperMesh);
  }
  return {
    object: light,
    type: typeLabel,
    options: { name: light.name }
  };
}

function createLight(kind) {
  const item = buildLightItem(kind);
  const object = addObjectToScene(item.object, item.type, item.options);
  object.traverse(child => {
    if (child !== object && child.userData?.internal) {
      child.userData.helperFor = object.userData.editorId;
      if (!selectableObjects.includes(child)) selectableObjects.push(child);
    }
  });
  refreshSceneTree();
  return object;
}


function makeCameraPreviewHelper(kind = 'perspectiveCamera') {
  const group = new THREE.Group();
  group.name = kind === 'orthographicCamera' ? 'Orthographic Camera Helper' : 'Perspective Camera Helper';
  group.userData.internal = true;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x78beff, wireframe: true })
  );
  body.name = 'Camera Body Picker';
  body.userData.internal = true;
  group.add(body);

  const z = -0.75;
  const w = kind === 'orthographicCamera' ? 0.95 : 0.72;
  const h = kind === 'orthographicCamera' ? 0.62 : 0.44;
  const points = [
    0, 0, 0, -w, h, z,
    0, 0, 0, w, h, z,
    0, 0, 0, w, -h, z,
    0, 0, 0, -w, -h, z,
    -w, h, z, w, h, z,
    w, h, z, w, -h, z,
    w, -h, z, -w, -h, z,
    -w, -h, z, -w, h, z
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x78beff, transparent: true, opacity: 0.9 }));
  lines.name = 'Camera Preview Frame Helper';
  lines.userData.internal = true;
  group.add(lines);
  return group;
}

function updateOrthographicCameraBounds(cam, aspect = Math.max(viewport.clientWidth, 1) / Math.max(viewport.clientHeight, 1)) {
  if (!cam?.isOrthographicCamera) return;
  const size = Number(cam.userData?.orthoSize) || 6;
  cam.left = -size * aspect / 2;
  cam.right = size * aspect / 2;
  cam.top = size / 2;
  cam.bottom = -size / 2;
  cam.updateProjectionMatrix?.();
}

function buildCameraItem(kind = 'perspectiveCamera', options = {}) {
  const aspect = Math.max(viewport.clientWidth, 1) / Math.max(viewport.clientHeight, 1);
  let cam;
  if (kind === 'orthographicCamera') {
    cam = new THREE.OrthographicCamera(-3 * aspect, 3 * aspect, 3, -3, 0.1, 1000);
    cam.userData.orthoSize = 6;
    cam.position.set(-3.5, 3.0, 5.0);
  } else {
    cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    cam.position.set(4.0, 3.0, 5.5);
  }
  cam.lookAt(0, 0, 0);
  const label = ADD_LABELS[kind] || 'Camera';
  cam.name = options.name || `${label} ${objectIndex++}`;
  cam.userData.cameraKind = kind;
  cam.add(makeCameraPreviewHelper(kind));
  return {
    object: cam,
    type: label,
    options: { name: cam.name }
  };
}

function createCamera(kind = 'perspectiveCamera') {
  const item = buildCameraItem(kind);
  const object = addObjectToScene(item.object, item.type, item.options);
  refreshSceneTree();
  return object;
}

function isSceneCameraObject(object) {
  return !!(object && (object.isCamera || object.isPerspectiveCamera || object.isOrthographicCamera));
}

function setCameraObjectHelpersVisible(object, visible) {
  if (!isSceneCameraObject(object)) return;
  object.traverse(child => {
    if (child !== object && child.userData?.internal) child.visible = visible;
  });
}

function getViewportCamera() {
  return activeCameraViewObject && activeCameraViewObject.parent ? activeCameraViewObject : camera;
}

function syncMainCameraFromCameraObject(sceneCamera) {
  if (!sceneCamera || !sceneCamera.parent) return;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  sceneCamera.updateMatrixWorld(true);
  sceneCamera.matrixWorld.decompose(pos, quat, scale);
  camera.position.copy(pos);
  camera.quaternion.copy(quat);
  if (sceneCamera.isPerspectiveCamera) {
    camera.fov = sceneCamera.fov;
    camera.aspect = Math.max(viewport.clientWidth, 1) / Math.max(viewport.clientHeight, 1);
    camera.near = sceneCamera.near;
    camera.far = sceneCamera.far;
    camera.zoom = sceneCamera.zoom;
  } else if (sceneCamera.isOrthographicCamera) {
    // Main editor camera is perspective, but the viewport still follows the
    // orthographic camera object's transform. The orthographic projection is
    // used when exporting/saving the actual camera object.
    camera.fov = 35;
    camera.near = sceneCamera.near;
    camera.far = sceneCamera.far;
    camera.zoom = sceneCamera.zoom;
  }
  camera.updateProjectionMatrix?.();
  const target = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(5).add(camera.position);
  orbit.target.copy(target);
  orbit.update?.();
}

function updateCameraFrameOverlay() {
  if (!cameraFrameOverlay) return;
  const active = activeCameraViewObject && activeCameraViewObject.parent;
  cameraFrameOverlay.classList.toggle('active', !!active);
  cameraFrameOverlay.setAttribute('aria-hidden', active ? 'false' : 'true');
  if (cameraViewBadge) cameraViewBadge.textContent = active ? `Camera View: ${activeCameraViewObject.name}` : 'Camera View';
}

function viewThroughCameraObject(object) {
  if (!isSceneCameraObject(object)) {
    notify('Select a Perspective or Orthographic camera object first.');
    return;
  }
  if (activeCameraViewObject && activeCameraViewObject !== object) setCameraObjectHelpersVisible(activeCameraViewObject, true);
  activeCameraViewObject = object;
  setCameraObjectHelpersVisible(activeCameraViewObject, false);
  if (activeCameraViewObject.isPerspectiveCamera) {
    activeCameraViewObject.aspect = Math.max(viewport.clientWidth, 1) / Math.max(viewport.clientHeight, 1);
    activeCameraViewObject.updateProjectionMatrix?.();
  }
  if (activeCameraViewObject.isOrthographicCamera) updateOrthographicCameraBounds(activeCameraViewObject);
  transform.camera = getViewportCamera();
  updateCameraFrameOverlay();
  notify(`Viewing through ${object.name}.`);
}

function exitCameraView() {
  if (!activeCameraViewObject) return;
  setCameraObjectHelpersVisible(activeCameraViewObject, true);
  activeCameraViewObject = null;
  transform.camera = camera;
  updateCameraFrameOverlay();
  resetView();
  notify('Exited camera view.');
}

function viewThroughSelectedCamera() {
  const object = selectedObjects.find(isSceneCameraObject);
  viewThroughCameraObject(object);
}

function createDefaultScene() {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x202030, 0.8);
  hemi.name = 'Default Hemisphere Light';
  hemi.userData.internal = true;
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(5, 6, 4);
  sun.castShadow = true;
  sun.name = 'Default Directional Light';
  sun.userData.internal = true;
  scene.add(sun);

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), createMaterial(0x7db5ff));
  cube.position.set(0, 0, 0);
  cube.name = 'Cube at Origin';
  addObjectToScene(cube, 'Cube', { name: 'Cube at Origin', position: new THREE.Vector3(0, 0, 0) });
}

function getRootEditorObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.helperFor) {
      return editorObjects.get(current.userData.helperFor) || null;
    }
    if (current.userData?.editorId && editorObjects.has(current.userData.editorId)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function isSelected(object) {
  return selectedObjects.includes(object);
}

function isEditorObject(object) {
  return !!(object?.userData?.editorId && editorObjects.has(object.userData.editorId));
}

function isObjectLocked(object, includeAncestors = true) {
  let current = object;
  while (current) {
    if (current.userData?.locked) return true;
    if (!includeAncestors) return false;
    current = current.parent;
  }
  return false;
}

function isObjectSelectable(object) {
  return !!(object && object.parent && !object.userData?.internal && !isObjectLocked(object));
}

function getEditorRoots() {
  return [...editorObjects.values()].filter(object => {
    if (!object.parent || object.userData?.internal) return false;
    return !isEditorObject(object.parent);
  });
}

function getEditorChildren(object) {
  return object.children.filter(child => isEditorObject(child));
}

function hasEditorAncestor(object, possibleAncestor) {
  let current = object?.parent;
  while (current) {
    if (current === possibleAncestor) return true;
    current = current.parent;
  }
  return false;
}

function attachPreserveWorld(parent, child) {
  const nextParent = parent || scene;
  nextParent.attach(child);
  child.updateMatrixWorld(true);
}

function canParentObject(child, parent) {
  if (!child || child === parent) return false;
  if (parent && hasEditorAncestor(parent, child)) return false;
  return true;
}

function hasModifier(event) {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

function isAdditiveSelectionEvent(event) {
  return event.shiftKey;
}

function isOrbitEvent(event) {
  return event.altKey;
}

function isPanEvent(event) {
  // Middle mouse is reserved for OrbitControls pan so left-drag can stay rectangle-select.
  return event.button === 1;
}

function setOrbitTemporaryEnabled(enabled) {
  if (transform.dragging) {
    orbit.enabled = false;
    return;
  }
  orbit.enabled = enabled;
}

function enableOrbitForWheelOnce() {
  if (transform.dragging) return;
  orbit.enabled = true;
  window.clearTimeout(enableOrbitForWheelOnce._timer);
  enableOrbitForWheelOnce._timer = window.setTimeout(() => {
    if (!transform.dragging) orbit.enabled = false;
  }, 160);
}

function resetPivotTransform() {
  selectionPivot.position.set(0, 0, 0);
  selectionPivot.rotation.set(0, 0, 0);
  selectionPivot.quaternion.identity();
  selectionPivot.scale.set(1, 1, 1);
  selectionPivot.updateMatrixWorld(true);
}

function selectObjects(objects) {
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedEdges.length = 0;
  selectedVertices.length = 0;
  for (const object of objects) {
    if (isObjectSelectable(object) && !selectedObjects.includes(object)) selectedObjects.push(object);
  }
  updateSelectionState();
}

function toggleSelection(object) {
  if (!isObjectSelectable(object)) {
    if (object && isObjectLocked(object)) notify('Locked object cannot be selected. Unlock it from Project Structure first.');
    return;
  }
  selectedFaces.length = 0;
  selectedEdges.length = 0;
  selectedVertices.length = 0;
  const index = selectedObjects.indexOf(object);
  if (index >= 0) selectedObjects.splice(index, 1);
  else selectedObjects.push(object);
  updateSelectionState();
}

function clearAllSelections() {
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedEdges.length = 0;
  selectedVertices.length = 0;
  updateSelectionState();
}

function addUniqueByKey(list, item) {
  if (!item) return;
  if (!list.some(entry => entry.key === item.key)) list.push(item);
}

function selectFaceItems(items, additive = false) {
  selectedObjects.length = 0;
  selectedEdges.length = 0;
  selectedVertices.length = 0;
  if (!additive) selectedFaces.length = 0;
  for (const item of items) addUniqueByKey(selectedFaces, item);
  updateSelectionState();
}

function toggleFaceItem(item) {
  if (!item) return;
  selectedObjects.length = 0;
  selectedEdges.length = 0;
  selectedVertices.length = 0;
  const index = selectedFaces.findIndex(entry => entry.key === item.key);
  if (index >= 0) selectedFaces.splice(index, 1);
  else selectedFaces.push(item);
  updateSelectionState();
}


function selectEdgeItems(items, additive = false) {
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedVertices.length = 0;
  if (!additive) selectedEdges.length = 0;
  for (const item of items) addUniqueByKey(selectedEdges, item);
  updateSelectionState();
}

function toggleEdgeItem(item) {
  if (!item) return;
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedVertices.length = 0;
  const index = selectedEdges.findIndex(entry => entry.key === item.key);
  if (index >= 0) selectedEdges.splice(index, 1);
  else selectedEdges.push(item);
  updateSelectionState();
}

function selectVertexItems(items, additive = false) {
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedEdges.length = 0;
  if (!additive) selectedVertices.length = 0;
  for (const item of items) addUniqueByKey(selectedVertices, item);
  updateSelectionState();
}

function toggleVertexItem(item) {
  if (!item) return;
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedEdges.length = 0;
  const index = selectedVertices.findIndex(entry => entry.key === item.key);
  if (index >= 0) selectedVertices.splice(index, 1);
  else selectedVertices.push(item);
  updateSelectionState();
}

function getComponentSelectionCount() {
  if (editMode === 'face') return selectedFaces.length;
  if (editMode === 'edge') return selectedEdges.length;
  if (editMode === 'vertex') return selectedVertices.length;
  return 0;
}

function updateSelectionState() {
  transform.detach();
  resetPivotTransform();
  for (let i = selectedObjects.length - 1; i >= 0; i--) {
    if (!isObjectSelectable(selectedObjects[i])) selectedObjects.splice(i, 1);
  }

  if (selectTool !== 'select') {
    if (editMode === 'object') {
      selectedFaces.length = 0;
      selectedEdges.length = 0;
      selectedVertices.length = 0;
      if (selectedObjects.length === 1) {
        transform.attach(selectedObjects[0]);
      } else if (selectedObjects.length > 1) {
        placeObjectSelectionPivotAtCenter();
        transform.attach(selectionPivot);
      }
    } else if (getComponentSelectionCount() > 0) {
      selectedObjects.length = 0;
      placeComponentSelectionPivotAtCenter();
      transform.attach(selectionPivot);
    }
  } else if (editMode === 'object') {
    selectedFaces.length = 0;
    selectedEdges.length = 0;
    selectedVertices.length = 0;
  }

  updateSelectedBadge();
  refreshSceneTree();
  refreshObjectWireOverlays();
  refreshComponentOverlays();
  refreshSceneTree();
  refreshInspector();
  refreshMaterialAsset();
  refreshToolProperties();
  captureAnimationSelectionBaselines();
  if (animationState.uiBuilt) refreshAnimationPanel(false);
}


function updateSelectedBadge() {
  if (editMode === 'object') {
    selectedBadge.textContent = selectedObjects.length
      ? `Mode: Object • Selected: ${selectedObjects.length === 1 ? selectedObjects[0].name : `${selectedObjects.length} objects`}`
      : 'Mode: Object • Selected: None';
  } else if (editMode === 'face') {
    selectedBadge.textContent = selectedFaces.length
      ? `Mode: Face • Selected: ${selectedFaces.length} face${selectedFaces.length === 1 ? '' : 's'}`
      : 'Mode: Face • Selected: None';
  } else if (editMode === 'edge') {
    selectedBadge.textContent = selectedEdges.length
      ? `Mode: Edge • Selected: ${selectedEdges.length} edge${selectedEdges.length === 1 ? '' : 's'}`
      : 'Mode: Edge • Selected: None';
  } else {
    selectedBadge.textContent = selectedVertices.length
      ? `Mode: Vertex • Selected: ${selectedVertices.length} vertex${selectedVertices.length === 1 ? '' : ' groups'}`
      : 'Mode: Vertex • Selected: None';
  }
}

function placeObjectSelectionPivotAtCenter() {
  tmpBox.makeEmpty();
  for (const object of selectedObjects) {
    object.updateMatrixWorld(true);
    if (object.isLight) {
      tmpBox.expandByPoint(object.getWorldPosition(tmpCenter));
    } else {
      tmpBox.expandByObject(object);
    }
  }
  if (tmpBox.isEmpty()) selectionPivot.position.set(0, 0, 0);
  else tmpBox.getCenter(selectionPivot.position);
  selectionPivot.rotation.set(0, 0, 0);
  selectionPivot.scale.set(1, 1, 1);
  selectionPivot.updateMatrixWorld(true);
}

function getTriangleVertexIndices(geometry, faceIndex) {
  if (!geometry || faceIndex == null || faceIndex < 0) return [];
  const index = geometry.index;
  const base = faceIndex * 3;
  if (index) return [index.getX(base), index.getX(base + 1), index.getX(base + 2)];
  return [base, base + 1, base + 2];
}

function getTriangleCount(geometry) {
  const pos = geometry?.attributes?.position;
  if (!pos) return 0;
  return geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(pos.count / 3);
}

function readLocalVertex(geometry, index, target = new THREE.Vector3()) {
  const pos = geometry.attributes.position;
  return target.fromBufferAttribute(pos, index);
}

function findEquivalentVertexIndices(geometry, sourceIndex) {
  const pos = geometry?.attributes?.position;
  if (!pos || sourceIndex == null) return [];
  const source = readLocalVertex(geometry, sourceIndex, new THREE.Vector3());
  const indices = [];
  for (let i = 0; i < pos.count; i++) {
    const current = readLocalVertex(geometry, i, new THREE.Vector3());
    if (current.distanceToSquared(source) < 1e-10) indices.push(i);
  }
  return indices.length ? indices : [sourceIndex];
}

function getTriangleLocalPositions(geometry, faceIndex) {
  const ids = getTriangleVertexIndices(geometry, faceIndex);
  if (ids.length !== 3) return null;
  return [
    readLocalVertex(geometry, ids[0], new THREE.Vector3()),
    readLocalVertex(geometry, ids[1], new THREE.Vector3()),
    readLocalVertex(geometry, ids[2], new THREE.Vector3())
  ];
}

function getTriangleNormalFromPositions(a, b, c, target = new THREE.Vector3()) {
  target.copy(c).sub(b);
  tmpVec3D.copy(a).sub(b);
  target.cross(tmpVec3D);
  if (target.lengthSq() > 1e-12) target.normalize();
  return target;
}

function makeFaceSelectionItem(object, faceIndex) {
  if (!object?.isMesh || !object.geometry?.attributes?.position || faceIndex == null) return null;
  const geometry = object.geometry;
  const clickedPositions = getTriangleLocalPositions(geometry, faceIndex);
  if (!clickedPositions) return null;

  // Three.js mesh faces are triangles. Face mode intentionally selects exactly the
  // triangulated face that was hit, not the whole coplanar quad/side.
  return {
    object,
    faceIndices: [faceIndex],
    key: `${object.userData.editorId}:tri-face:${faceIndex}`
  };
}


function makeSortedEdgeKeyPart(a, b) {
  const aKey = roundedVertexKey(a);
  const bKey = roundedVertexKey(b);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function closestPointOnSegment(point, a, b, target = new THREE.Vector3()) {
  const ab = tmpVec3D.copy(b).sub(a);
  const denom = ab.lengthSq();
  if (denom < 1e-12) return target.copy(a);
  const t = THREE.MathUtils.clamp(tmpVec3C.copy(point).sub(a).dot(ab) / denom, 0, 1);
  return target.copy(a).addScaledVector(ab, t);
}

function getNearestTriangleEdge(object, hit) {
  if (!object?.isMesh || !object.geometry?.attributes?.position || hit.faceIndex == null) return null;
  const ids = getTriangleVertexIndices(object.geometry, hit.faceIndex);
  if (ids.length !== 3) return null;
  const verts = ids.map(id => readLocalVertex(object.geometry, id, new THREE.Vector3()));
  const hitLocal = object.worldToLocal(hit.point.clone());
  const candidates = [
    { aIndex: ids[0], bIndex: ids[1], a: verts[0], b: verts[1] },
    { aIndex: ids[1], bIndex: ids[2], a: verts[1], b: verts[2] },
    { aIndex: ids[2], bIndex: ids[0], a: verts[2], b: verts[0] }
  ];
  let best = null;
  let bestDist = Infinity;
  for (const edge of candidates) {
    const closest = closestPointOnSegment(hitLocal, edge.a, edge.b, new THREE.Vector3());
    const dist = closest.distanceToSquared(hitLocal);
    if (dist < bestDist) {
      bestDist = dist;
      best = edge;
    }
  }
  return best;
}

function makeEdgeSelectionItem(object, hitOrFaceEdge) {
  if (!object?.isMesh || !object.geometry?.attributes?.position || !hitOrFaceEdge) return null;
  let edge = hitOrFaceEdge;
  if (hitOrFaceEdge.faceIndex != null || hitOrFaceEdge.point) edge = getNearestTriangleEdge(object, hitOrFaceEdge);
  if (!edge) return null;

  const aLocal = readLocalVertex(object.geometry, edge.aIndex, new THREE.Vector3());
  const bLocal = readLocalVertex(object.geometry, edge.bIndex, new THREE.Vector3());
  const keyPart = makeSortedEdgeKeyPart(aLocal, bLocal);
  const indices = [];
  for (const index of findEquivalentVertexIndices(object.geometry, edge.aIndex)) indices.push(index);
  for (const index of findEquivalentVertexIndices(object.geometry, edge.bIndex)) if (!indices.includes(index)) indices.push(index);
  return {
    object,
    aIndex: edge.aIndex,
    bIndex: edge.bIndex,
    indices,
    key: `${object.userData.editorId}:edge:${keyPart}`
  };
}

function roundedVertexKey(v) {
  return `${v.x.toFixed(5)}_${v.y.toFixed(5)}_${v.z.toFixed(5)}`;
}

function makeVertexSelectionItem(object, hit) {
  if (!object?.isMesh || !object.geometry?.attributes?.position || hit.faceIndex == null) return null;
  const geometry = object.geometry;
  const indices = getTriangleVertexIndices(geometry, hit.faceIndex);
  if (!indices.length) return null;

  const hitLocal = object.worldToLocal(hit.point.clone());
  let bestIndex = indices[0];
  let bestDist = Infinity;
  for (const index of indices) {
    const local = readLocalVertex(geometry, index, new THREE.Vector3());
    const dist = local.distanceToSquared(hitLocal);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = index;
    }
  }

  const selectedLocal = readLocalVertex(geometry, bestIndex, new THREE.Vector3());
  const keyPart = roundedVertexKey(selectedLocal);
  const allIndices = [];
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = readLocalVertex(geometry, i, new THREE.Vector3());
    if (v.distanceToSquared(selectedLocal) < 1e-10) allIndices.push(i);
  }

  return {
    object,
    indices: allIndices.length ? allIndices : [bestIndex],
    key: `${object.userData.editorId}:vertex:${keyPart}`
  };
}

function getSelectedComponentVertexRefs() {
  const refs = new Map();

  if (editMode === 'face') {
    for (const item of selectedFaces) {
      for (const faceIndex of item.faceIndices) {
        for (const index of getTriangleVertexIndices(item.object.geometry, faceIndex)) {
          // Move every coincident vertex index too. This keeps the selected
          // triangulated face welded/attached to neighbouring object geometry,
          // even on geometries with split normals/UV seams like BoxGeometry.
          for (const linkedIndex of findEquivalentVertexIndices(item.object.geometry, index)) {
            refs.set(`${item.object.userData.editorId}:${linkedIndex}`, { object: item.object, index: linkedIndex });
          }
        }
      }
    }
  } else if (editMode === 'edge') {
    for (const item of selectedEdges) {
      for (const index of item.indices) {
        for (const linkedIndex of findEquivalentVertexIndices(item.object.geometry, index)) {
          refs.set(`${item.object.userData.editorId}:${linkedIndex}`, { object: item.object, index: linkedIndex });
        }
      }
    }
  } else if (editMode === 'vertex') {
    for (const item of selectedVertices) {
      for (const index of item.indices) {
        refs.set(`${item.object.userData.editorId}:${index}`, { object: item.object, index });
      }
    }
  }

  return [...refs.values()];
}

function placeComponentSelectionPivotAtCenter() {
  const refs = getSelectedComponentVertexRefs();
  if (!refs.length) {
    selectionPivot.position.set(0, 0, 0);
    return;
  }

  tmpBox.makeEmpty();
  for (const ref of refs) {
    ref.object.updateMatrixWorld(true);
    const local = readLocalVertex(ref.object.geometry, ref.index, new THREE.Vector3());
    const world = local.applyMatrix4(ref.object.matrixWorld);
    tmpBox.expandByPoint(world);
  }
  tmpBox.getCenter(selectionPivot.position);
  selectionPivot.rotation.set(0, 0, 0);
  selectionPivot.scale.set(1, 1, 1);
  selectionPivot.updateMatrixWorld(true);
}

function clearObjectWireOverlays() {
  for (const child of [...objectWireOverlayGroup.children]) {
    objectWireOverlayGroup.remove(child);
    child.geometry?.dispose?.();
  }
}

function refreshObjectWireOverlays() {
  clearObjectWireOverlays();
  if (selectTool !== 'select' || editMode !== 'object' || !selectedObjects.length) return;

  for (const object of selectedObjects) {
    if (!object?.isMesh || !object.geometry) continue;
    object.updateMatrixWorld(true);
    const edges = new THREE.EdgesGeometry(object.geometry, 1);
    const wire = new THREE.LineSegments(edges, objectWireMaterial);
    wire.matrix.copy(object.matrixWorld);
    wire.matrixAutoUpdate = false;
    wire.renderOrder = 1001;
    objectWireOverlayGroup.add(wire);
  }
}

function clearComponentOverlays() {
  for (const child of [...componentOverlayGroup.children]) {
    componentOverlayGroup.remove(child);
    if (child.geometry && child.geometry !== vertexOverlayGeometry) child.geometry.dispose();
  }
}

function clearHoverOverlays() {
  for (const child of [...componentHoverOverlayGroup.children]) {
    componentHoverOverlayGroup.remove(child);
    if (child.geometry && child.geometry !== vertexHoverGeometry) child.geometry.dispose();
  }
}

function clearHoverItems() {
  hoveredFace = null;
  hoveredEdge = null;
  hoveredVertex = null;
  refreshHoverOverlays();
}

function makeWorldTriangleOverlay(object, faceIndices, material, renderOrder = 998) {
  const positions = [];
  object.updateMatrixWorld(true);
  for (const faceIndex of faceIndices) {
    const ids = getTriangleVertexIndices(object.geometry, faceIndex);
    for (const id of ids) {
      const world = readLocalVertex(object.geometry, id, new THREE.Vector3()).applyMatrix4(object.matrixWorld);
      positions.push(world.x, world.y, world.z);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function makeWorldEdgeOverlay(item, material, renderOrder = 1000) {
  if (!item?.object?.geometry) return null;
  item.object.updateMatrixWorld(true);
  const a = readLocalVertex(item.object.geometry, item.aIndex, new THREE.Vector3()).applyMatrix4(item.object.matrixWorld);
  const b = readLocalVertex(item.object.geometry, item.bIndex, new THREE.Vector3()).applyMatrix4(item.object.matrixWorld);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3));
  const line = new THREE.LineSegments(geometry, material);
  line.renderOrder = renderOrder;
  return line;
}

function makeWorldVertexOverlay(item, material, geometry, renderOrder = 1000) {
  if (!item?.object?.geometry) return null;
  item.object.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  for (const index of item.indices) center.add(readLocalVertex(item.object.geometry, index, new THREE.Vector3()));
  center.multiplyScalar(1 / Math.max(item.indices.length, 1)).applyMatrix4(item.object.matrixWorld);
  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(center);
  marker.renderOrder = renderOrder;
  return marker;
}

function refreshHoverOverlays() {
  clearHoverOverlays();
  if (transform.dragging || boxDragState) return;
  if (editMode === 'face' && hoveredFace && !selectedFaces.some(item => item.key === hoveredFace.key)) {
    const mesh = makeWorldTriangleOverlay(hoveredFace.object, hoveredFace.faceIndices, faceHoverMaterial, 998);
    if (mesh) componentHoverOverlayGroup.add(mesh);
  } else if (editMode === 'edge' && hoveredEdge && !selectedEdges.some(item => item.key === hoveredEdge.key)) {
    const line = makeWorldEdgeOverlay(hoveredEdge, edgeHoverMaterial, 1002);
    if (line) componentHoverOverlayGroup.add(line);
  } else if (editMode === 'vertex' && hoveredVertex && !selectedVertices.some(item => item.key === hoveredVertex.key)) {
    const marker = makeWorldVertexOverlay(hoveredVertex, vertexHoverMaterial, vertexHoverGeometry, 1002);
    if (marker) componentHoverOverlayGroup.add(marker);
  }
}

function refreshComponentOverlays() {
  clearComponentOverlays();
  if (editMode === 'object') return;

  if (editMode === 'face') {
    for (const item of selectedFaces) {
      const mesh = makeWorldTriangleOverlay(item.object, item.faceIndices, faceOverlayMaterial, 999);
      if (mesh) componentOverlayGroup.add(mesh);
    }
  }

  if (editMode === 'edge') {
    for (const item of selectedEdges) {
      const line = makeWorldEdgeOverlay(item, edgeOverlayMaterial, 1001);
      if (line) componentOverlayGroup.add(line);
    }
  }

  if (editMode === 'vertex') {
    for (const item of selectedVertices) {
      const marker = makeWorldVertexOverlay(item, vertexOverlayMaterial, vertexOverlayGeometry, 1000);
      if (marker) componentOverlayGroup.add(marker);
    }
  }
  refreshHoverOverlays();
}

function captureObjectTransformStates(objects) {
  return objects
    .filter(object => object && object.parent)
    .map(object => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone()
    }));
}

function applyObjectTransformStates(states) {
  for (const state of states) {
    state.object.position.copy(state.position);
    state.object.quaternion.copy(state.quaternion);
    state.object.scale.copy(state.scale);
    state.object.updateMatrixWorld(true);
  }
  if (editMode === 'object' && selectedObjects.length > 1) placeObjectSelectionPivotAtCenter();
  refreshObjectWireOverlays();
  refreshSceneTree();
  refreshInspector();
}

function transformStatesDiffer(before, after) {
  if (!before || !after || before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i].object !== after[i].object) return true;
    if (before[i].position.distanceToSquared(after[i].position) > 1e-10) return true;
    if (before[i].scale.distanceToSquared(after[i].scale) > 1e-10) return true;
    if (Math.abs(before[i].quaternion.dot(after[i].quaternion)) < 0.999999) return true;
  }
  return false;
}

function getActiveComponentObjects() {
  const objects = new Set();
  for (const ref of getSelectedComponentVertexRefs()) objects.add(ref.object);
  return [...objects];
}

function captureGeometryPositionStates(objects) {
  return objects
    .filter(object => object?.isMesh && object.geometry?.attributes?.position)
    .map(object => ({
      object,
      positions: Float32Array.from(object.geometry.attributes.position.array)
    }));
}

function applyGeometryPositionStates(states) {
  for (const state of states) {
    const pos = state.object.geometry.attributes.position;
    pos.array.set(state.positions);
    pos.needsUpdate = true;
    state.object.geometry.computeVertexNormals?.();
    state.object.geometry.computeBoundingBox?.();
    state.object.geometry.computeBoundingSphere?.();
    state.object.updateMatrixWorld(true);
  }
  if (editMode !== 'object' && getComponentSelectionCount() > 0) placeComponentSelectionPivotAtCenter();
  refreshComponentOverlays();
  refreshHoverOverlays();
  refreshInspector();
}

function geometryStatesDiffer(before, after) {
  if (!before || !after || before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i].object !== after[i].object) return true;
    const a = before[i].positions;
    const b = after[i].positions;
    if (a.length !== b.length) return true;
    for (let j = 0; j < a.length; j++) {
      if (Math.abs(a[j] - b[j]) > 1e-7) return true;
    }
  }
  return false;
}


function notify(message) {
  window.alert(message);
}

function captureGeometryCloneStates(objects) {
  return objects
    .filter(object => object?.isMesh && object.geometry?.attributes?.position)
    .map(object => ({ object, geometry: object.geometry.clone() }));
}

function applyGeometryCloneStates(states) {
  for (const state of states) {
    if (!state?.object || !state.geometry) continue;
    state.object.geometry = state.geometry.clone();
    state.object.geometry.computeVertexNormals?.();
    state.object.geometry.computeBoundingBox?.();
    state.object.geometry.computeBoundingSphere?.();
    state.object.updateMatrixWorld(true);
  }
  refreshObjectWireOverlays();
  refreshComponentOverlays();
  refreshHoverOverlays();
  refreshSceneTree();
  refreshInspector();
}

function geometryCloneStatesDiffer(before, after) {
  if (!before || !after || before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i].object !== after[i].object) return true;
    const a = before[i].geometry?.attributes?.position?.array || [];
    const b = after[i].geometry?.attributes?.position?.array || [];
    if (a.length !== b.length) return true;
    for (let j = 0; j < a.length; j++) {
      if (Math.abs(a[j] - b[j]) > 1e-7) return true;
    }
  }
  return false;
}

function gatherEditableComponentObjects() {
  const objects = new Set();
  if (editMode === 'object') {
    for (const object of selectedObjects) if (object?.isMesh) objects.add(object);
  } else if (editMode === 'face') {
    for (const item of selectedFaces) if (item?.object?.isMesh) objects.add(item.object);
  } else if (editMode === 'edge') {
    for (const item of selectedEdges) if (item?.object?.isMesh) objects.add(item.object);
  } else if (editMode === 'vertex') {
    for (const item of selectedVertices) if (item?.object?.isMesh) objects.add(item.object);
  }
  return [...objects];
}

function geometryToTriangleArray(geometry) {
  const triangles = [];
  const triCount = getTriangleCount(geometry);
  for (let faceIndex = 0; faceIndex < triCount; faceIndex++) {
    const ids = getTriangleVertexIndices(geometry, faceIndex);
    if (ids.length !== 3) continue;
    triangles.push(ids.map(id => readLocalVertex(geometry, id, new THREE.Vector3())));
  }
  return triangles;
}

function buildGeometryFromTriangles(triangles) {
  const positions = [];
  for (const tri of triangles) {
    for (const v of tri) positions.push(v.x, v.y, v.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals?.();
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  return geometry;
}

function getObjectSelectedFaceIndices(object) {
  const set = new Set();
  for (const item of selectedFaces) {
    if (item.object !== object) continue;
    for (const faceIndex of item.faceIndices) set.add(faceIndex);
  }
  return set;
}

function getObjectSelectedEdges(object) {
  return selectedEdges.filter(item => item.object === object);
}

function getObjectSelectedVertices(object) {
  return selectedVertices.filter(item => item.object === object);
}

function getGeometryLocalCenter(geometry) {
  geometry.computeBoundingBox?.();
  const box = geometry.boundingBox || new THREE.Box3();
  return box.getCenter(new THREE.Vector3());
}

function uniqueLocalPointsForIndices(object, indices) {
  const points = [];
  const seen = new Set();
  for (const index of indices) {
    const p = readLocalVertex(object.geometry, index, new THREE.Vector3());
    const key = roundedVertexKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      points.push(p);
    }
  }
  return points;
}

function findFirstVertexIndexNear(geometry, point, epsilon = 1e-8) {
  const pos = geometry?.attributes?.position;
  if (!pos) return -1;
  const epsSq = epsilon * epsilon;
  for (let i = 0; i < pos.count; i++) {
    const current = readLocalVertex(geometry, i, new THREE.Vector3());
    if (current.distanceToSquared(point) <= epsSq) return i;
  }
  return -1;
}

function makeEdgeSelectionItemFromLocalPoints(object, aPoint, bPoint) {
  const aIndex = findFirstVertexIndexNear(object.geometry, aPoint);
  const bIndex = findFirstVertexIndexNear(object.geometry, bPoint);
  if (aIndex < 0 || bIndex < 0 || aIndex === bIndex) return null;
  return makeEdgeSelectionItem(object, { aIndex, bIndex });
}

function makeVertexSelectionItemFromLocalPoint(object, point) {
  const index = findFirstVertexIndexNear(object.geometry, point);
  if (index < 0) return null;
  const selectedLocal = readLocalVertex(object.geometry, index, new THREE.Vector3());
  const keyPart = roundedVertexKey(selectedLocal);
  return {
    object,
    indices: findEquivalentVertexIndices(object.geometry, index),
    key: `${object.userData.editorId}:vertex:${keyPart}`
  };
}

function getExtrudeAmountVector() {
  const ex = modelingToolSettings.extrude;
  return new THREE.Vector3(
    THREE.MathUtils.clamp(Number(ex.amountX) || 0, -10, 10),
    THREE.MathUtils.clamp(Number(ex.amountY) || 0, -10, 10),
    THREE.MathUtils.clamp(Number(ex.amountZ) || 0, -10, 10)
  );
}

function getDefaultExtrudeFallbackVector(direction) {
  const amountVector = getExtrudeAmountVector();
  if (amountVector.lengthSq() > 1e-10) return amountVector;
  const fallbackDir = direction?.clone?.() || new THREE.Vector3(0, 1, 0);
  if (fallbackDir.lengthSq() < 1e-8) fallbackDir.set(0, 1, 0);
  return fallbackDir.normalize().multiplyScalar(0.45);
}


function pointKeyFromVector(v) {
  return `${v.x.toFixed(5)}_${v.y.toFixed(5)}_${v.z.toFixed(5)}`;
}

function faceAdjacencyEdgeKey(a, b) {
  const ka = pointKeyFromVector(a);
  const kb = pointKeyFromVector(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function triangleEdgesFromPoints(a, b, c) {
  return [
    { a, b, key: faceAdjacencyEdgeKey(a, b) },
    { a: b, b: c, key: faceAdjacencyEdgeKey(b, c) },
    { a: c, b: a, key: faceAdjacencyEdgeKey(c, a) }
  ];
}


function getSelectedFaceConnectedGroups(triangles, faceIndices) {
  const selected = [...faceIndices].filter(faceIndex => triangles[faceIndex]);
  const edgeToFaces = new Map();

  for (const faceIndex of selected) {
    const [a, b, c] = triangles[faceIndex];
    for (const edge of triangleEdgesFromPoints(a, b, c)) {
      if (!edgeToFaces.has(edge.key)) edgeToFaces.set(edge.key, []);
      edgeToFaces.get(edge.key).push(faceIndex);
    }
  }

  const neighbors = new Map();
  for (const faceIndex of selected) neighbors.set(faceIndex, new Set());

  for (const faces of edgeToFaces.values()) {
    if (faces.length < 2) continue;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        neighbors.get(faces[i])?.add(faces[j]);
        neighbors.get(faces[j])?.add(faces[i]);
      }
    }
  }

  const groups = [];
  const visited = new Set();

  for (const start of selected) {
    if (visited.has(start)) continue;

    const group = new Set();
    const stack = [start];
    visited.add(start);

    while (stack.length) {
      const faceIndex = stack.pop();
      group.add(faceIndex);

      for (const next of neighbors.get(faceIndex) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    groups.push(group);
  }

  return groups;
}

function applyCombinedFaceExtrudeByConnectedGroups(object, triangles, faceIndices, created) {
  const groups = getSelectedFaceConnectedGroups(triangles, faceIndices);
  let changed = false;

  for (const group of groups) {
    if (applyCombinedFaceExtrude(object, triangles, group, created)) {
      changed = true;
    }
  }

  return changed;
}

function applyCombinedFaceExtrude(object, triangles, faceIndices, created) {
  const topVertexMap = new Map();
  const boundaryEdges = new Map();
  let changed = false;

  for (const faceIndex of faceIndices) {
    const tri = triangles[faceIndex];
    if (!tri) continue;
    const [a, b, c] = tri.map(v => v.clone());
    const normal = getTriangleNormalFromPositions(a, b, c, new THREE.Vector3());
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);

    for (const p of [a, b, c]) {
      const key = pointKeyFromVector(p);
      if (!topVertexMap.has(key)) topVertexMap.set(key, { base: p.clone(), normal: new THREE.Vector3() });
      topVertexMap.get(key).normal.add(normal);
    }

    for (const edge of triangleEdgesFromPoints(a, b, c)) {
      if (!boundaryEdges.has(edge.key)) {
        boundaryEdges.set(edge.key, { count: 0, a: edge.a.clone(), b: edge.b.clone() });
      }
      boundaryEdges.get(edge.key).count += 1;
    }
    changed = true;
  }

  if (!changed) return false;

  for (const entry of topVertexMap.values()) {
    entry.top = entry.base.clone().add(getDefaultExtrudeFallbackVector(entry.normal));
  }

  for (const faceIndex of faceIndices) {
    const tri = triangles[faceIndex];
    if (!tri) continue;
    const topFaceIndex = triangles.length;
    triangles.push(tri.map(v => topVertexMap.get(pointKeyFromVector(v)).top.clone()));
    created.faces.push(topFaceIndex);
  }

  for (const edge of boundaryEdges.values()) {
    if (edge.count !== 1) continue;
    const aTop = topVertexMap.get(pointKeyFromVector(edge.a)).top.clone();
    const bTop = topVertexMap.get(pointKeyFromVector(edge.b)).top.clone();
    triangles.push([edge.a.clone(), edge.b.clone(), bTop.clone()]);
    triangles.push([edge.a.clone(), bTop.clone(), aTop.clone()]);
  }
  return true;
}

function applyCombinedEdgeExtrude(object, geometry, triangles, edges, created) {
  const center = getGeometryLocalCenter(geometry);
  const pointMap = new Map();
  const uniqueEdges = new Map();
  let changed = false;

  for (const edge of edges) {
    const a = readLocalVertex(geometry, edge.aIndex, new THREE.Vector3());
    const b = readLocalVertex(geometry, edge.bIndex, new THREE.Vector3());
    const ka = pointKeyFromVector(a);
    const kb = pointKeyFromVector(b);
    if (!pointMap.has(ka)) {
      let dir = a.clone().sub(center);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      dir.normalize();
      pointMap.set(ka, { base: a.clone(), top: a.clone().add(getDefaultExtrudeFallbackVector(dir)) });
    }
    if (!pointMap.has(kb)) {
      let dir = b.clone().sub(center);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      dir.normalize();
      pointMap.set(kb, { base: b.clone(), top: b.clone().add(getDefaultExtrudeFallbackVector(dir)) });
    }
    const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (!uniqueEdges.has(edgeKey)) uniqueEdges.set(edgeKey, { ka, kb });
    changed = true;
  }

  if (!changed) return false;

  for (const { ka, kb } of uniqueEdges.values()) {
    const a = pointMap.get(ka).base.clone();
    const b = pointMap.get(kb).base.clone();
    const aTop = pointMap.get(ka).top.clone();
    const bTop = pointMap.get(kb).top.clone();
    triangles.push([a.clone(), b.clone(), bTop.clone()]);
    triangles.push([a.clone(), bTop.clone(), aTop.clone()]);
    created.edges.push({ a: aTop.clone(), b: bTop.clone() });
  }
  return true;
}

function applyCombinedVertexExtrude(object, geometry, triangles, vertices, created) {
  const center = getGeometryLocalCenter(geometry);
  const vertexMap = new Map();
  let changed = false;

  for (const item of vertices) {
    const points = uniqueLocalPointsForIndices(object, item.indices);
    for (const p of points) {
      const key = pointKeyFromVector(p);
      if (!vertexMap.has(key)) {
        let dir = p.clone().sub(center);
        if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
        dir.normalize();
        vertexMap.set(key, { base: p.clone(), top: p.clone().add(getDefaultExtrudeFallbackVector(dir)), connected: false });
      }
      changed = true;
    }
  }
  if (!changed) return false;

  const meshEdges = new Map();
  for (const tri of geometryToTriangleArray(geometry)) {
    const [a, b, c] = tri;
    for (const edge of triangleEdgesFromPoints(a, b, c)) {
      meshEdges.set(edge.key, { a: edge.a.clone(), b: edge.b.clone() });
    }
  }

  for (const edge of meshEdges.values()) {
    const ka = pointKeyFromVector(edge.a);
    const kb = pointKeyFromVector(edge.b);
    if (!vertexMap.has(ka) || !vertexMap.has(kb)) continue;
    const a = vertexMap.get(ka).base.clone();
    const b = vertexMap.get(kb).base.clone();
    const aTop = vertexMap.get(ka).top.clone();
    const bTop = vertexMap.get(kb).top.clone();
    triangles.push([a.clone(), b.clone(), bTop.clone()]);
    triangles.push([a.clone(), bTop.clone(), aTop.clone()]);
    vertexMap.get(ka).connected = true;
    vertexMap.get(kb).connected = true;
  }

  for (const entry of vertexMap.values()) {
    if (entry.connected) {
      created.vertices.push(entry.top.clone());
      continue;
    }
    const p = entry.base.clone();
    const tip = entry.top.clone();
    let dir = tip.clone().sub(p);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize().multiplyScalar(0.08);
    triangles.push([p.clone(), tip.clone(), tip.clone().add(side)]);
    triangles.push([p.clone(), tip.clone().sub(side), tip.clone()]);
    created.vertices.push(tip.clone());
  }
  return true;
}

function applyExtrudeToObject(object) {
  const geometry = object.geometry;
  const triangles = geometryToTriangleArray(geometry);
  let changed = false;
  const created = { faces: [], edges: [], vertices: [] };
  const combine = !!modelingToolSettings.extrude.combine;

  if (editMode === 'face') {
    const faceIndices = getObjectSelectedFaceIndices(object);
    if (!faceIndices.size) return { changed: false, created };
    if (combine) {
      changed = applyCombinedFaceExtrudeByConnectedGroups(object, triangles, faceIndices, created);
    } else {
      const originalTriCount = triangles.length;
      for (const faceIndex of faceIndices) {
        if (faceIndex < 0 || faceIndex >= originalTriCount) continue;
        const [a, b, c] = triangles[faceIndex].map(v => v.clone());
        const normal = getTriangleNormalFromPositions(a, b, c, new THREE.Vector3());
        if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
        const offset = getDefaultExtrudeFallbackVector(normal);
        const a2 = a.clone().add(offset);
        const b2 = b.clone().add(offset);
        const c2 = c.clone().add(offset);
        const topFaceIndex = triangles.length;
        triangles.push([a2.clone(), b2.clone(), c2.clone()]);
        triangles.push([a.clone(), b.clone(), b2.clone()], [a.clone(), b2.clone(), a2.clone()]);
        triangles.push([b.clone(), c.clone(), c2.clone()], [b.clone(), c2.clone(), b2.clone()]);
        triangles.push([c.clone(), a.clone(), a2.clone()], [c.clone(), a2.clone(), c2.clone()]);
        created.faces.push(topFaceIndex);
        changed = true;
      }
    }
  } else if (editMode === 'edge') {
    const edges = getObjectSelectedEdges(object);
    if (!edges.length) return { changed: false, created };
    if (combine) {
      changed = applyCombinedEdgeExtrude(object, geometry, triangles, edges, created);
    } else {
      const center = getGeometryLocalCenter(geometry);
      for (const edge of edges) {
        const a = readLocalVertex(geometry, edge.aIndex, new THREE.Vector3());
        const b = readLocalVertex(geometry, edge.bIndex, new THREE.Vector3());
        const mid = a.clone().add(b).multiplyScalar(0.5);
        let dir = mid.clone().sub(center);
        if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
        dir.normalize();
        const offset = getDefaultExtrudeFallbackVector(dir);
        const a2 = a.clone().add(offset);
        const b2 = b.clone().add(offset);
        triangles.push([a.clone(), b.clone(), b2.clone()], [a.clone(), b2.clone(), a2.clone()]);
        created.edges.push({ a: a2.clone(), b: b2.clone() });
        changed = true;
      }
    }
  } else if (editMode === 'vertex') {
    const vertices = getObjectSelectedVertices(object);
    if (!vertices.length) return { changed: false, created };
    if (combine) {
      changed = applyCombinedVertexExtrude(object, geometry, triangles, vertices, created);
    } else {
      const center = getGeometryLocalCenter(geometry);
      for (const item of vertices) {
        const points = uniqueLocalPointsForIndices(object, item.indices);
        for (const p of points) {
          let dir = p.clone().sub(center);
          if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
          dir.normalize();
          const tip = p.clone().add(getDefaultExtrudeFallbackVector(dir));
          const side = new THREE.Vector3(-dir.z, 0, dir.x);
          if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
          side.normalize().multiplyScalar(0.08);
          triangles.push([p.clone(), tip.clone(), tip.clone().add(side)]);
          triangles.push([p.clone(), tip.clone().sub(side), tip.clone()]);
          created.vertices.push(tip.clone());
          changed = true;
        }
      }
    }
  }

  if (!changed) return { changed: false, created };
  object.geometry = buildGeometryFromTriangles(triangles);

  const selection = { faces: [], edges: [], vertices: [] };
  for (const faceIndex of created.faces) {
    const item = makeFaceSelectionItem(object, faceIndex);
    if (item) selection.faces.push(item);
  }
  for (const edge of created.edges) {
    const item = makeEdgeSelectionItemFromLocalPoints(object, edge.a, edge.b);
    if (item) selection.edges.push(item);
  }
  for (const vertex of created.vertices) {
    const item = makeVertexSelectionItemFromLocalPoint(object, vertex);
    if (item) selection.vertices.push(item);
  }

  return { changed: true, selection };
}

function applyOffsetToolToObject(object, strength) {
  const refs = getSelectedComponentVertexRefs().filter(ref => ref.object === object);
  if (!refs.length) return false;
  const geometry = object.geometry;
  const pos = geometry.attributes.position;
  const localPoints = refs.map(ref => readLocalVertex(geometry, ref.index, new THREE.Vector3()));
  const center = localPoints.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / Math.max(localPoints.length, 1));
  const touched = new Set();
  for (const ref of refs) {
    if (touched.has(ref.index)) continue;
    touched.add(ref.index);
    const current = readLocalVertex(geometry, ref.index, new THREE.Vector3());
    let dir = current.clone().sub(center);
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    dir.normalize();
    current.addScaledVector(dir, strength);
    pos.setXYZ(ref.index, current.x, current.y, current.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals?.();
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  return true;
}

function applyMulticutToObject(object) {
  if (editMode !== 'face') return false;
  const faceIndices = getObjectSelectedFaceIndices(object);
  if (!faceIndices.size) return false;
  const oldTriangles = geometryToTriangleArray(object.geometry);
  const nextTriangles = [];
  for (let i = 0; i < oldTriangles.length; i++) {
    const tri = oldTriangles[i];
    if (!faceIndices.has(i)) {
      nextTriangles.push(tri.map(v => v.clone()));
      continue;
    }
    const [a, b, c] = tri.map(v => v.clone());
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    nextTriangles.push([a.clone(), b.clone(), m.clone()]);
    nextTriangles.push([b.clone(), c.clone(), m.clone()]);
    nextTriangles.push([c.clone(), a.clone(), m.clone()]);
  }
  object.geometry = buildGeometryFromTriangles(nextTriangles);
  return true;
}

function mirrorVector(v, axis) {
  const out = v.clone();
  out[axis] *= -1;
  return out;
}

function applyMirrorComponentsToObject(object, axis) {
  const triangles = geometryToTriangleArray(object.geometry);
  const append = [];
  if (editMode === 'face') {
    for (const faceIndex of getObjectSelectedFaceIndices(object)) {
      const tri = triangles[faceIndex];
      if (tri) append.push([mirrorVector(tri[0], axis), mirrorVector(tri[2], axis), mirrorVector(tri[1], axis)]);
    }
  } else if (editMode === 'edge') {
    for (const edge of getObjectSelectedEdges(object)) {
      const a = mirrorVector(readLocalVertex(object.geometry, edge.aIndex, new THREE.Vector3()), axis);
      const b = mirrorVector(readLocalVertex(object.geometry, edge.bIndex, new THREE.Vector3()), axis);
      const center = a.clone().add(b).multiplyScalar(0.5);
      const lift = new THREE.Vector3(0, 0.08, 0);
      append.push([a.clone(), b.clone(), center.clone().add(lift)]);
    }
  } else if (editMode === 'vertex') {
    for (const item of getObjectSelectedVertices(object)) {
      const points = uniqueLocalPointsForIndices(object, item.indices);
      for (const p of points) {
        const m = mirrorVector(p, axis);
        append.push([m.clone().add(new THREE.Vector3(0.05, 0, 0)), m.clone().add(new THREE.Vector3(0, 0.05, 0)), m.clone().add(new THREE.Vector3(0, 0, 0.05))]);
      }
    }
  }
  if (!append.length) return false;
  object.geometry = buildGeometryFromTriangles([...triangles.map(tri => tri.map(v => v.clone())), ...append]);
  return true;
}

function cloneObjectForMirror(object, axis) {
  const clone = object.clone(true);
  clone.name = `${object.name} Mirror ${axis.toUpperCase()}`;
  clone.userData = { ...object.userData, editorId: null };
  if (clone.isMesh && object.geometry) {
    clone.geometry = object.geometry.clone();
    const sx = axis === 'x' ? -1 : 1;
    const sy = axis === 'y' ? -1 : 1;
    const sz = axis === 'z' ? -1 : 1;
    clone.geometry.scale(sx, sy, sz);
    clone.geometry.computeVertexNormals?.();
    if (object.material?.clone) clone.material = object.material.clone();
  }
  clone.position.copy(object.position);
  clone.position[axis] *= -1;
  clone.traverse(child => {
    if (child !== clone && child.userData) child.userData = { ...child.userData, helperFor: null };
    if (child.isMesh && child.material?.clone && child.material === object.material) child.material = child.material.clone();
  });
  return clone;
}

function executeGeometryTopologyTool(label, objects, mutator, nextMode = editMode) {
  const editable = objects.filter(object => object?.isMesh && object.geometry?.attributes?.position);
  if (!editable.length) {
    notify(`${label}: select an editable mesh/component first.`);
    return;
  }
  const before = captureGeometryCloneStates(editable);
  let changed = false;
  for (const object of editable) {
    const result = mutator(object);
    if (result === true || result?.changed) changed = true;
  }
  if (!changed) {
    applyGeometryCloneStates(before);
    notify(`${label}: nothing to apply. Select a valid component first.`);
    return;
  }
  const after = captureGeometryCloneStates(editable);
  commandManager.record(new GeometryReplaceCommand(label, before, after, nextMode));
  clearAllSelections();
  setSelectTool('select');
}


function captureActiveExtrudeSessionFromSelection() {
  const refs = getSelectedComponentVertexRefs();
  if (!refs.length) return null;
  const seen = new Set();
  const vertexStates = [];
  for (const ref of refs) {
    const key = `${ref.object.userData.editorId}:${ref.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vertexStates.push({
      object: ref.object,
      index: ref.index,
      baseLocal: readLocalVertex(ref.object.geometry, ref.index, new THREE.Vector3())
    });
  }
  placeComponentSelectionPivotAtCenter();
  selectionPivot.updateMatrixWorld(true);
  return {
    mode: editMode,
    vertexStates,
    basePivotWorld: selectionPivot.position.clone()
  };
}

function applyExtrudeAmountsFromProperties(recordUndo = true) {
  if (!activeExtrudeSession?.vertexStates?.length) return false;
  const before = recordUndo ? captureGeometryPositionStates(getActiveComponentObjects()) : null;
  const amount = getExtrudeAmountVector();
  const changedObjects = new Set();
  for (const state of activeExtrudeSession.vertexStates) {
    const geometry = state.object.geometry;
    const pos = geometry.attributes.position;
    const next = state.baseLocal.clone().add(amount);
    pos.setXYZ(state.index, next.x, next.y, next.z);
    changedObjects.add(state.object);
  }
  for (const object of changedObjects) {
    const geometry = object.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals?.();
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
  }
  placeComponentSelectionPivotAtCenter();
  refreshComponentOverlays();
  refreshHoverOverlays();
  refreshInspector(false);
  const after = recordUndo ? captureGeometryPositionStates(getActiveComponentObjects()) : null;
  if (recordUndo) commandManager.record(new ComponentGeometryCommand(before, after));
  return true;
}

function syncExtrudeAmountsFromGizmo() {
  if (!activeExtrudeSession?.basePivotWorld || activePropertiesTool !== 'extrude') return;
  placeComponentSelectionPivotAtCenter();
  const delta = selectionPivot.position.clone().sub(activeExtrudeSession.basePivotWorld);
  modelingToolSettings.extrude.amountX = THREE.MathUtils.clamp(delta.x, -10, 10);
  modelingToolSettings.extrude.amountY = THREE.MathUtils.clamp(delta.y, -10, 10);
  modelingToolSettings.extrude.amountZ = THREE.MathUtils.clamp(delta.z, -10, 10);
}

function setExtrudeAmountProperty(axisKey, value, rangeInput = null, numberInput = null) {
  const next = THREE.MathUtils.clamp(parseFloat(value) || 0, -10, 10);
  modelingToolSettings.extrude[axisKey] = next;
  if (rangeInput) rangeInput.value = String(next);
  if (numberInput) numberInput.value = toFixed(next);
  applyExtrudeAmountsFromProperties(true);
}

function extrudeAmountProperty(label, axisKey) {
  const row = document.createElement('div');
  row.className = 'form-row range-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const wrap = document.createElement('div');
  wrap.className = 'range-control';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '-10';
  range.max = '10';
  range.step = '0.1';
  range.value = String(modelingToolSettings.extrude[axisKey]);
  const number = document.createElement('input');
  number.type = 'number';
  number.min = '-10';
  number.max = '10';
  number.step = '0.1';
  number.value = toFixed(modelingToolSettings.extrude[axisKey]);
  range.addEventListener('input', () => setExtrudeAmountProperty(axisKey, range.value, range, number));
  number.addEventListener('input', () => setExtrudeAmountProperty(axisKey, number.value, range, number));
  wrap.append(range, number);
  row.append(labelEl, wrap);
  return row;
}

function selectCreatedExtrudeComponents(createdItems, mode) {
  selectedObjects.length = 0;
  selectedFaces.length = 0;
  selectedEdges.length = 0;
  selectedVertices.length = 0;

  if (mode === 'face') {
    for (const item of createdItems.faces) addUniqueByKey(selectedFaces, item);
  } else if (mode === 'edge') {
    for (const item of createdItems.edges) addUniqueByKey(selectedEdges, item);
  } else if (mode === 'vertex') {
    for (const item of createdItems.vertices) addUniqueByKey(selectedVertices, item);
  }
}

function activateExtrudeTranslateGizmo() {
  currentTransformMode = 'translate';
  selectTool = 'transform';
  transform.setMode('translate');
  selectToolBtn?.classList.remove('active');
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === 'translate');
  });
  activePropertiesTool = 'extrude';
  updateSelectionState();
  refreshToolProperties();
}

function runExtrudeTool() {
  if (editMode === 'object') {
    notify('Extrude works in Face, Edge, or Vertex mode. Switch mode from the right-click Mode menu and select components first.');
    return;
  }
  if (getComponentSelectionCount() <= 0) {
    notify('Extrude: select one or more Face, Edge, or Vertex components first.');
    return;
  }

  const modeBeforeExtrude = editMode;
  activePropertiesTool = 'extrude';
  refreshToolProperties();

  const editable = gatherEditableComponentObjects().filter(object => object?.isMesh && object.geometry?.attributes?.position);
  if (!editable.length) {
    notify('Extrude: select an editable mesh/component first.');
    return;
  }

  const before = captureGeometryCloneStates(editable);
  const createdItems = { faces: [], edges: [], vertices: [] };
  let changed = false;
  for (const object of editable) {
    const result = applyExtrudeToObject(object);
    if (!result?.changed) continue;
    changed = true;
    if (result.selection?.faces) createdItems.faces.push(...result.selection.faces);
    if (result.selection?.edges) createdItems.edges.push(...result.selection.edges);
    if (result.selection?.vertices) createdItems.vertices.push(...result.selection.vertices);
  }

  if (!changed) {
    applyGeometryCloneStates(before);
    notify('Extrude: nothing to apply. Select a valid component first.');
    return;
  }

  const after = captureGeometryCloneStates(editable);
  commandManager.record(new GeometryReplaceCommand('Extrude', before, after, modeBeforeExtrude));
  setEditMode(modeBeforeExtrude, { keepSelection: true });
  selectCreatedExtrudeComponents(createdItems, modeBeforeExtrude);
  modelingToolSettings.extrude.amountX = 0;
  modelingToolSettings.extrude.amountY = 0;
  modelingToolSettings.extrude.amountZ = 0;
  activeExtrudeSession = captureActiveExtrudeSessionFromSelection();
  activateExtrudeTranslateGizmo();
  notify('Extrude applied. Translate gizmo is attached to the newly extruded component; drag it or use Extrude Amount X/Y/Z in Properties to adjust the extrusion.');
}

function runBevelTool() {
  if (editMode === 'object') {
    notify('Bevel works on selected Face, Edge, or Vertex components in this version.');
    return;
  }
  activePropertiesTool = 'bevel';
  refreshToolProperties();
  executeGeometryTopologyTool('Bevel', gatherEditableComponentObjects(), object => applyOffsetToolToObject(object, modelingToolSettings.bevel.amount), editMode);
}

function runChamferTool() {
  if (editMode === 'object') {
    notify('Chamfer works on selected Face, Edge, or Vertex components in this version.');
    return;
  }
  activePropertiesTool = 'chamfer';
  refreshToolProperties();
  executeGeometryTopologyTool('Chamfer', gatherEditableComponentObjects(), object => applyOffsetToolToObject(object, modelingToolSettings.chamfer.amount), editMode);
}

function runMulticutTool() {
  if (editMode !== 'face') {
    notify('Multicut currently works in Face mode. Select one or more triangulated faces first.');
    return;
  }
  activePropertiesTool = 'multicut';
  refreshToolProperties();
  executeGeometryTopologyTool('Multicut', gatherEditableComponentObjects(), applyMulticutToObject, 'face');
}

function runMirrorTool(axis = 'x') {
  activePropertiesTool = 'mirror';
  modelingToolSettings.mirror.axis = axis || 'x';
  refreshToolProperties();
  if (editMode === 'object') {
    if (!selectedObjects.length) {
      notify(`Mirror ${axis.toUpperCase()}: select one or more objects first.`);
      return;
    }
    const items = selectedObjects.map(object => ({
      object: cloneObjectForMirror(object, axis),
      type: object.userData.editorType || object.type,
      options: { name: `${object.name} Mirror ${axis.toUpperCase()}` }
    }));
    commandManager.execute(new AddMultipleObjectsCommand(`Mirror ${axis.toUpperCase()}`, items));
    return;
  }
  executeGeometryTopologyTool(`Mirror ${axis.toUpperCase()}`, gatherEditableComponentObjects(), object => applyMirrorComponentsToObject(object, axis), editMode);
}


function cloneMaterialForEditor(material) {
  if (Array.isArray(material)) return material.map(mat => mat?.clone ? mat.clone() : mat);
  return material?.clone ? material.clone() : material;
}

function cloneEditorObjectForDuplicate(object, nameSuffix = ' Copy') {
  const clone = object.clone(false);
  clone.name = `${object.name || object.type}${nameSuffix}`;
  clone.userData = { ...object.userData, editorId: null };
  if (object.geometry?.clone) clone.geometry = object.geometry.clone();
  if (object.material) clone.material = cloneMaterialForEditor(object.material);
  clone.position.copy(object.position);
  clone.quaternion.copy(object.quaternion);
  clone.scale.copy(object.scale);
  clone.children.length = 0;
  object.children.forEach(child => {
    if (child.userData?.internal) return;
    const childClone = child.clone(true);
    childClone.userData = { ...childClone.userData, editorId: null };
    if (child.geometry?.clone) childClone.geometry = child.geometry.clone();
    if (child.material) childClone.material = cloneMaterialForEditor(child.material);
    clone.add(childClone);
  });
  return clone;
}

function runDuplicateTool() {
  activePropertiesTool = 'duplicate';
  refreshToolProperties(true);

  if (editMode === 'object') {
    if (!selectedObjects.length) {
      notify('Duplicate: select one or more objects first.');
      return;
    }
    const offset = new THREE.Vector3(
      Number(modelingToolSettings.duplicate.offsetX) || 0,
      Number(modelingToolSettings.duplicate.offsetY) || 0,
      Number(modelingToolSettings.duplicate.offsetZ) || 0
    );
    const items = selectedObjects.map(object => {
      const clone = cloneEditorObjectForDuplicate(object, ' Copy');
      clone.position.add(offset);
      return { object: clone, type: object.userData.editorType || object.type, options: { name: clone.name } };
    });
    commandManager.execute(new AddMultipleObjectsCommand('Duplicate Objects', items));
    return;
  }

  const meshes = gatherEditableComponentObjects();
  if (!meshes.length) {
    notify('Duplicate: select faces, edges, or vertices first.');
    return;
  }
  const items = [];
  for (const mesh of meshes) {
    const triangles = [];
    if (editMode === 'face') {
      const all = geometryToTriangleArray(mesh.geometry);
      for (const faceIndex of getObjectSelectedFaceIndices(mesh)) if (all[faceIndex]) triangles.push(all[faceIndex].map(v => v.clone()));
    } else if (editMode === 'edge') {
      for (const edge of getObjectSelectedEdges(mesh)) {
        const a = readLocalVertex(mesh.geometry, edge.aIndex, new THREE.Vector3());
        const b = readLocalVertex(mesh.geometry, edge.bIndex, new THREE.Vector3());
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const lift = new THREE.Vector3(0, 0.04, 0);
        triangles.push([a.clone(), b.clone(), mid.clone().add(lift)]);
      }
    } else if (editMode === 'vertex') {
      for (const item of getObjectSelectedVertices(mesh)) {
        for (const p of uniqueLocalPointsForIndices(mesh, item.indices)) {
          const s = 0.055;
          triangles.push([
            p.clone().add(new THREE.Vector3(s, 0, 0)),
            p.clone().add(new THREE.Vector3(0, s, 0)),
            p.clone().add(new THREE.Vector3(0, 0, s))
          ]);
        }
      }
    }
    if (!triangles.length) continue;
    const dupGeo = buildGeometryFromTriangles(triangles);
    const dup = new THREE.Mesh(dupGeo, cloneMaterialForEditor(getEditableMaterial(mesh)) || createMaterial());
    dup.name = `${mesh.name || 'Component'} Duplicate`;
    dup.matrix.copy(mesh.matrixWorld);
    dup.matrix.decompose(dup.position, dup.quaternion, dup.scale);
    dup.position.add(new THREE.Vector3(modelingToolSettings.duplicate.offsetX, modelingToolSettings.duplicate.offsetY, modelingToolSettings.duplicate.offsetZ));
    items.push({ object: dup, type: 'mesh', options: { name: dup.name } });
  }
  if (!items.length) notify('Duplicate: no valid component geometry found.');
  else commandManager.execute(new AddMultipleObjectsCommand('Duplicate Components', items));
}

function deleteComponentsSelection() {
  const editable = gatherEditableComponentObjects().filter(object => object?.isMesh && object.geometry?.attributes?.position);
  if (!editable.length) return false;
  const before = captureGeometryCloneStates(editable);
  let changed = false;
  for (const object of editable) {
    const oldTriangles = geometryToTriangleArray(object.geometry);
    const nextTriangles = [];
    const remove = new Set();
    if (editMode === 'face') {
      for (const faceIndex of getObjectSelectedFaceIndices(object)) remove.add(faceIndex);
    } else if (editMode === 'edge') {
      const edges = getObjectSelectedEdges(object).map(edge => {
        const a = readLocalVertex(object.geometry, edge.aIndex, new THREE.Vector3());
        const b = readLocalVertex(object.geometry, edge.bIndex, new THREE.Vector3());
        return faceAdjacencyEdgeKey(a, b);
      });
      oldTriangles.forEach((tri, faceIndex) => {
        const triEdges = triangleEdgesFromPoints(tri[0], tri[1], tri[2]).map(edge => edge.key);
        if (edges.some(edgeKey => triEdges.includes(edgeKey))) remove.add(faceIndex);
      });
    } else if (editMode === 'vertex') {
      const vkeys = new Set();
      for (const item of getObjectSelectedVertices(object)) {
        for (const p of uniqueLocalPointsForIndices(object, item.indices)) vkeys.add(pointKeyFromVector(p));
      }
      oldTriangles.forEach((tri, faceIndex) => {
        if (tri.some(v => vkeys.has(pointKeyFromVector(v)))) remove.add(faceIndex);
      });
    }
    if (!remove.size) continue;
    oldTriangles.forEach((tri, index) => { if (!remove.has(index)) nextTriangles.push(tri.map(v => v.clone())); });
    object.geometry = buildGeometryFromTriangles(nextTriangles);
    changed = true;
  }
  if (!changed) return false;
  const after = captureGeometryCloneStates(editable);
  commandManager.record(new GeometryReplaceCommand('Delete Components', before, after, editMode));
  clearAllSelections();
  return true;
}

function runDeleteTool() {
  activePropertiesTool = 'delete';
  refreshToolProperties(true);
  deleteSelected();
}

function snapNumber(value, step) {
  const s = Math.max(0.0001, Number(step) || 1);
  return Math.round(value / s) * s;
}

function applySnapToSelection(recordUndo = true) {
  const settings = modelingToolSettings.snap;
  if (!settings.enabled && recordUndo !== 'force') return false;
  const gridSize = Number(settings.gridSize) || 1;
  const rotStep = THREE.MathUtils.degToRad(Number(settings.rotationStep) || 15);
  const scaleStep = Number(settings.scaleStep) || 0.1;

  if (editMode === 'object') {
    if (!selectedObjects.length) return false;
    const before = recordUndo === true ? captureObjectTransformStates(selectedObjects) : null;
    for (const object of selectedObjects) {
      object.position.set(snapNumber(object.position.x, gridSize), snapNumber(object.position.y, gridSize), snapNumber(object.position.z, gridSize));
      object.rotation.set(snapNumber(object.rotation.x, rotStep), snapNumber(object.rotation.y, rotStep), snapNumber(object.rotation.z, rotStep));
      object.scale.set(snapNumber(object.scale.x, scaleStep), snapNumber(object.scale.y, scaleStep), snapNumber(object.scale.z, scaleStep));
      object.updateMatrixWorld(true);
    }
    if (recordUndo === true) commandManager.record(new ObjectTransformCommand(before, captureObjectTransformStates(selectedObjects)));
    updateSelectionState();
    return true;
  }

  const objects = getActiveComponentObjects();
  if (!objects.length) return false;
  const before = recordUndo === true ? captureGeometryPositionStates(objects) : null;
  const refs = getSelectedComponentVertexRefs();
  const touched = new Set();
  for (const ref of refs) {
    const key = `${ref.object.userData.editorId}:${ref.index}`;
    if (touched.has(key)) continue;
    touched.add(key);
    const pos = ref.object.geometry.attributes.position;
    const v = readLocalVertex(ref.object.geometry, ref.index, new THREE.Vector3());
    pos.setXYZ(ref.index, snapNumber(v.x, gridSize), snapNumber(v.y, gridSize), snapNumber(v.z, gridSize));
  }
  for (const object of objects) {
    object.geometry.attributes.position.needsUpdate = true;
    object.geometry.computeVertexNormals?.();
    object.geometry.computeBoundingBox?.();
    object.geometry.computeBoundingSphere?.();
  }
  if (recordUndo === true) commandManager.record(new ComponentGeometryCommand(before, captureGeometryPositionStates(objects)));
  updateSelectionState();
  return true;
}

function runSnapTool() {
  activePropertiesTool = 'snap';
  modelingToolSettings.snap.enabled = true;
  refreshToolProperties(true);
  notify('Snap is enabled. Move/rotate/scale selected objects or components; release the gizmo to snap. Use Properties to change snap settings or apply snap immediately.');
}

function getObjectAxisValue(object, axis, mode) {
  const box = new THREE.Box3().setFromObject(object);
  if (mode === 'min') return box.min[axis];
  if (mode === 'max') return box.max[axis];
  return (box.min[axis] + box.max[axis]) / 2;
}

function applyAlignToSelection() {
  const settings = modelingToolSettings.align;
  const axis = settings.axis || 'x';
  const alignTo = settings.alignTo || 'center';
  if (editMode === 'object') {
    if (selectedObjects.length < 2) {
      notify('Align: select at least two objects.');
      return false;
    }
    const before = captureObjectTransformStates(selectedObjects);
    const values = selectedObjects.map(object => getObjectAxisValue(object, axis, alignTo));
    const target = alignTo === 'min' ? Math.min(...values) : alignTo === 'max' ? Math.max(...values) : values.reduce((a,b)=>a+b,0) / values.length;
    for (const object of selectedObjects) {
      const current = getObjectAxisValue(object, axis, alignTo);
      object.position[axis] += target - current;
      object.updateMatrixWorld(true);
    }
    commandManager.record(new ObjectTransformCommand(before, captureObjectTransformStates(selectedObjects)));
    updateSelectionState();
    return true;
  }

  const objects = getActiveComponentObjects();
  const refs = getSelectedComponentVertexRefs();
  if (refs.length < 2) {
    notify('Align: select at least two faces/edges/vertices.');
    return false;
  }
  const before = captureGeometryPositionStates(objects);
  const values = refs.map(ref => readLocalVertex(ref.object.geometry, ref.index, new THREE.Vector3())[axis]);
  const target = alignTo === 'min' ? Math.min(...values) : alignTo === 'max' ? Math.max(...values) : values.reduce((a,b)=>a+b,0) / values.length;
  const touched = new Set();
  for (const ref of refs) {
    const key = `${ref.object.userData.editorId}:${ref.index}`;
    if (touched.has(key)) continue;
    touched.add(key);
    const v = readLocalVertex(ref.object.geometry, ref.index, new THREE.Vector3());
    v[axis] = target;
    ref.object.geometry.attributes.position.setXYZ(ref.index, v.x, v.y, v.z);
  }
  for (const object of objects) {
    object.geometry.attributes.position.needsUpdate = true;
    object.geometry.computeVertexNormals?.();
    object.geometry.computeBoundingBox?.();
    object.geometry.computeBoundingSphere?.();
  }
  commandManager.record(new ComponentGeometryCommand(before, captureGeometryPositionStates(objects)));
  updateSelectionState();
  return true;
}

function runAlignTool() {
  activePropertiesTool = 'align';
  refreshToolProperties(true);
  applyAlignToSelection();
}

function applyUVMappingToMesh(mesh) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) return false;
  const settings = modelingToolSettings.uvMapping;
  const geometry = mesh.geometry;
  geometry.computeBoundingBox?.();
  const box = geometry.boundingBox || new THREE.Box3();
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const pos = geometry.attributes.position;
  const uvs = [];
  const repeatU = Number(settings.repeatU) || 1;
  const repeatV = Number(settings.repeatV) || 1;
  const offsetU = Number(settings.offsetU) || 0;
  const offsetV = Number(settings.offsetV) || 0;
  const angle = THREE.MathUtils.degToRad(Number(settings.rotation) || 0);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let i = 0; i < pos.count; i++) {
    const p = readLocalVertex(geometry, i, new THREE.Vector3());
    let u = 0, v = 0;
    if (settings.projection === 'spherical') {
      const d = p.clone().sub(center);
      const len = Math.max(d.length(), 1e-6);
      u = 0.5 + Math.atan2(d.z, d.x) / (Math.PI * 2);
      v = 0.5 - Math.asin(d.y / len) / Math.PI;
    } else if (settings.projection === 'cylindrical') {
      const d = p.clone().sub(center);
      u = 0.5 + Math.atan2(d.z, d.x) / (Math.PI * 2);
      v = (p.y - box.min.y) / Math.max(size.y, 1e-6);
    } else if (settings.projection === 'planar-xz') {
      u = (p.x - box.min.x) / Math.max(size.x, 1e-6);
      v = (p.z - box.min.z) / Math.max(size.z, 1e-6);
    } else if (settings.projection === 'planar-xy') {
      u = (p.x - box.min.x) / Math.max(size.x, 1e-6);
      v = (p.y - box.min.y) / Math.max(size.y, 1e-6);
    } else {
      const nx = Math.abs((p.x - center.x) / Math.max(size.x, 1e-6));
      const ny = Math.abs((p.y - center.y) / Math.max(size.y, 1e-6));
      const nz = Math.abs((p.z - center.z) / Math.max(size.z, 1e-6));
      if (ny >= nx && ny >= nz) {
        u = (p.x - box.min.x) / Math.max(size.x, 1e-6);
        v = (p.z - box.min.z) / Math.max(size.z, 1e-6);
      } else if (nx >= ny && nx >= nz) {
        u = (p.z - box.min.z) / Math.max(size.z, 1e-6);
        v = (p.y - box.min.y) / Math.max(size.y, 1e-6);
      } else {
        u = (p.x - box.min.x) / Math.max(size.x, 1e-6);
        v = (p.y - box.min.y) / Math.max(size.y, 1e-6);
      }
    }
    const ru = (u - 0.5) * cos - (v - 0.5) * sin + 0.5;
    const rv = (u - 0.5) * sin + (v - 0.5) * cos + 0.5;
    uvs.push(ru * repeatU + offsetU, rv * repeatV + offsetV);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.attributes.uv.needsUpdate = true;
  return true;
}

function applyUVMappingToSelection() {
  const meshes = editMode === 'object' ? selectedObjects.filter(o => o?.isMesh) : gatherEditableComponentObjects();
  if (!meshes.length) {
    notify('UV Mapping: select one or more mesh objects or mesh components.');
    return false;
  }
  const before = captureGeometryCloneStates(meshes);
  let changed = false;
  for (const mesh of meshes) if (applyUVMappingToMesh(mesh)) changed = true;
  if (changed) commandManager.record(new GeometryReplaceCommand('UV Mapping', before, captureGeometryCloneStates(meshes), editMode));
  refreshMaterialAsset();
  return changed;
}

function runUVMappingTool() {
  activePropertiesTool = 'uvMapping';
  refreshToolProperties(true);
  applyUVMappingToSelection();
}

function getSelectedMeshList() {
  if (editMode === 'object') return selectedObjects.filter(o => o?.isMesh);
  const mesh = getSingleSelectedMesh();
  return mesh ? [mesh] : [];
}

function applyTextureControlsToSelection() {
  const settings = modelingToolSettings.textureControls;
  const meshes = getSelectedMeshList();
  if (!meshes.length) {
    notify('Texture Controls: select a textured mesh first.');
    return false;
  }
  let changed = false;
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const texture = material?.map;
      if (!texture) continue;
      texture.repeat.set(Number(settings.repeatU) || 1, Number(settings.repeatV) || 1);
      texture.offset.set(Number(settings.offsetU) || 0, Number(settings.offsetV) || 0);
      texture.rotation = THREE.MathUtils.degToRad(Number(settings.rotation) || 0);
      const wrap = THREE[settings.wrap] || THREE.RepeatWrapping;
      texture.wrapS = wrap;
      texture.wrapT = wrap;
      texture.flipY = Boolean(settings.flipY);
      texture.needsUpdate = true;
      material.needsUpdate = true;
      changed = true;
    }
  }
  if (!changed) notify('Texture Controls: selected material has no texture. Upload a texture in the Material Asset tab first.');
  refreshMaterialAsset();
  return changed;
}

function runTextureControlsTool() {
  activePropertiesTool = 'textureControls';
  refreshToolProperties(true);
  applyTextureControlsToSelection();
}

function ensureMaterialArray(mesh) {
  if (!Array.isArray(mesh.material)) mesh.material = [mesh.material || createMaterial()];
  return mesh.material;
}

function getFaceMaterialIndexArray(geometry) {
  const triCount = getTriangleCount(geometry);
  const indices = new Array(triCount).fill(0);
  if (geometry.groups?.length) {
    for (const group of geometry.groups) {
      const startFace = Math.floor((group.start || 0) / 3);
      const countFaces = Math.ceil((group.count || 0) / 3);
      for (let i = 0; i < countFaces; i++) if (startFace + i < indices.length) indices[startFace + i] = group.materialIndex || 0;
    }
  }
  return indices;
}

function rebuildFaceMaterialGroups(geometry, materialIndices) {
  geometry.clearGroups();
  for (let faceIndex = 0; faceIndex < materialIndices.length; faceIndex++) {
    geometry.addGroup(faceIndex * 3, 3, materialIndices[faceIndex] || 0);
  }
}

function applyMultiMaterialToSelection() {
  if (editMode !== 'face' || !selectedFaces.length) {
    notify('Multi-material Face Assignment works in Face mode. Select one or more faces first.');
    return false;
  }
  const meshes = gatherEditableComponentObjects();
  let changed = false;
  for (const mesh of meshes) {
    const faceIndices = getObjectSelectedFaceIndices(mesh);
    if (!faceIndices.size) continue;
    const materials = ensureMaterialArray(mesh);
    const newMaterial = createMaterialByType(modelingToolSettings.multiMaterial.materialType || 'MeshStandardMaterial', {
      color: modelingToolSettings.multiMaterial.color || '#ff8f00',
      name: modelingToolSettings.multiMaterial.materialName || 'Face Material'
    });
    const materialIndex = materials.length;
    materials.push(newMaterial);
    const faceMats = getFaceMaterialIndexArray(mesh.geometry);
    for (const faceIndex of faceIndices) if (faceIndex >= 0 && faceIndex < faceMats.length) faceMats[faceIndex] = materialIndex;
    rebuildFaceMaterialGroups(mesh.geometry, faceMats);
    mesh.geometry.groupsNeedUpdate = true;
    changed = true;
  }
  if (changed) {
    refreshMaterialAsset();
    refreshComponentOverlays();
    notify('Multi-material assigned to selected faces.');
  }
  return changed;
}

function runMultiMaterialTool() {
  activePropertiesTool = 'multiMaterial';
  refreshToolProperties(true);
  applyMultiMaterialToSelection();
}

function createArrayClone(object, index) {
  const s = modelingToolSettings.array;
  const clone = cloneEditorObjectForDuplicate(object, ` Array ${index}`);
  if (s.mode === 'circular') {
    const count = Math.max(1, Math.floor(Number(s.count) || 1));
    const angleTotal = THREE.MathUtils.degToRad(Number(s.angle) || 360);
    const angle = count <= 1 ? 0 : (angleTotal / count) * index;
    const radius = Number(s.radius) || 2;
    const axis = s.axis || 'y';
    const center = object.position.clone();
    if (axis === 'x') clone.position.set(center.x, center.y + Math.cos(angle) * radius, center.z + Math.sin(angle) * radius);
    else if (axis === 'z') clone.position.set(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, center.z);
    else clone.position.set(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius);
  } else {
    clone.position.add(new THREE.Vector3(
      (Number(s.offsetX) || 0) * index,
      (Number(s.offsetY) || 0) * index,
      (Number(s.offsetZ) || 0) * index
    ));
  }
  return clone;
}

function applyArrayTool() {
  if (editMode !== 'object' || !selectedObjects.length) {
    notify('Array works in Object mode. Select one or more objects first.');
    return false;
  }
  const count = Math.max(1, Math.floor(Number(modelingToolSettings.array.count) || 1));
  const start = modelingToolSettings.array.includeOriginal ? 1 : 0;
  const items = [];
  for (const object of selectedObjects) {
    for (let i = start; i < count; i++) {
      const clone = createArrayClone(object, i);
      items.push({ object: clone, type: object.userData.editorType || object.type, options: { name: clone.name } });
    }
  }
  if (!items.length) {
    notify('Array: count creates no additional objects. Increase Count or disable Include Original.');
    return false;
  }
  commandManager.execute(new AddMultipleObjectsCommand(`${capitalize(modelingToolSettings.array.mode)} Array`, items));
  return true;
}

function runArrayTool() {
  activePropertiesTool = 'array';
  refreshToolProperties(true);
  applyArrayTool();
}


function runGridMeasurementTool() {
  activePropertiesTool = 'gridMeasure';
  syncGridMeasurementSettings();
  setSelectTool('select');
  refreshToolProperties(true);
  notify('Grid / Measurement tool active. Choose Distance, Angle, or Ruler in Properties, then click points in the viewport.');
}

function getMeasurementWorldPoint(event) {
  const meshHit = findEditableMeshHit(event);
  if (meshHit?.hit?.point) return meshHit.hit.point.clone();
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, getViewportCamera());
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, hit)) return hit;
  return null;
}

function handleMeasurementPointerDown(event) {
  if (activePropertiesTool !== 'gridMeasure') return false;
  if (event.button !== 0 || isOrbitEvent(event) || isPanEvent(event)) return false;
  const point = getMeasurementWorldPoint(event);
  if (!point) return false;
  event.preventDefault();
  event.stopPropagation();
  gridMeasurementManager.addMeasurementPoint(point);
  return true;
}

function runModelingTool(tool, axis = 'x') {
  activePropertiesTool = tool === 'mirror' ? 'mirror' : tool;
  if (tool === 'mirror') modelingToolSettings.mirror.axis = axis || 'x';
  refreshToolProperties();
  hideContextMenu();
  closeTopToolsMenu();
  closeToolDropdowns();
  if (tool === 'extrude') runExtrudeTool();
  else if (tool === 'bevel') runBevelTool();
  else if (tool === 'chamfer') runChamferTool();
  else if (tool === 'multicut') runMulticutTool();
  else if (tool === 'mirror') runMirrorTool(axis || 'x');
  else if (tool === 'delete') runDeleteTool();
  else if (tool === 'duplicate') runDuplicateTool();
  else if (tool === 'snap') runSnapTool();
  else if (tool === 'align') runAlignTool();
  else if (tool === 'uvMapping') runUVMappingTool();
  else if (tool === 'textureControls') runTextureControlsTool();
  else if (tool === 'multiMaterial') runMultiMaterialTool();
  else if (tool === 'array') runArrayTool();
  else if (tool === 'gridMeasure') runGridMeasurementTool();
}

function openGuideModal() {
  guideModal?.classList.add('open');
  guideModal?.setAttribute('aria-hidden', 'false');
}

function closeGuideModal() {
  guideModal?.classList.remove('open');
  guideModal?.setAttribute('aria-hidden', 'true');
}

function closeTopToolsMenu() {
  toolsMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
  fileMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
  viewMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
  createMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
}

function prepareMultiDrag() {
  if (editMode !== 'object' || selectedObjects.length <= 1 || transform.object !== selectionPivot) return;
  selectionPivot.updateMatrixWorld(true);
  const pivotStartWorld = selectionPivot.matrixWorld.clone();
  const pivotStartWorldInverse = pivotStartWorld.clone().invert();

  multiDragState = {
    pivotStartWorld,
    pivotStartWorldInverse,
    objectStates: selectedObjects.map(object => {
      object.updateMatrixWorld(true);
      const parentWorldInverse = new THREE.Matrix4();
      if (object.parent) {
        object.parent.updateMatrixWorld(true);
        parentWorldInverse.copy(object.parent.matrixWorld).invert();
      }
      return {
        object,
        startWorldMatrix: object.matrixWorld.clone(),
        parentWorldInverse
      };
    })
  };
}

function applyMultiDrag() {
  if (!multiDragState || editMode !== 'object' || selectedObjects.length <= 1 || transform.object !== selectionPivot) return;
  selectionPivot.updateMatrixWorld(true);
  const delta = selectionPivot.matrixWorld.clone().multiply(multiDragState.pivotStartWorldInverse);

  for (const state of multiDragState.objectStates) {
    const newWorld = delta.clone().multiply(state.startWorldMatrix);
    const newLocal = state.parentWorldInverse.clone().multiply(newWorld);
    newLocal.decompose(state.object.position, state.object.quaternion, state.object.scale);
    state.object.updateMatrixWorld(true);
  }
  refreshInspector(false);
}

function prepareComponentDrag() {
  if (editMode === 'object' || getComponentSelectionCount() <= 0 || transform.object !== selectionPivot) return;
  const refs = getSelectedComponentVertexRefs();
  if (!refs.length) return;

  selectionPivot.updateMatrixWorld(true);
  const pivotStartWorld = selectionPivot.matrixWorld.clone();
  const pivotStartWorldInverse = pivotStartWorld.clone().invert();

  componentDragState = {
    pivotStartWorld,
    pivotStartWorldInverse,
    vertexStates: refs.map(ref => {
      ref.object.updateMatrixWorld(true);
      const local = readLocalVertex(ref.object.geometry, ref.index, new THREE.Vector3());
      return {
        object: ref.object,
        index: ref.index,
        objectWorldInverse: ref.object.matrixWorld.clone().invert(),
        startWorld: local.clone().applyMatrix4(ref.object.matrixWorld)
      };
    })
  };
}

function applyComponentDrag() {
  if (!componentDragState || editMode === 'object' || transform.object !== selectionPivot) return;
  selectionPivot.updateMatrixWorld(true);
  const delta = selectionPivot.matrixWorld.clone().multiply(componentDragState.pivotStartWorldInverse);
  const changedObjects = new Set();

  for (const state of componentDragState.vertexStates) {
    const geometry = state.object.geometry;
    const pos = geometry.attributes.position;
    const newWorld = state.startWorld.clone().applyMatrix4(delta);
    const newLocal = newWorld.applyMatrix4(state.objectWorldInverse);
    pos.setXYZ(state.index, newLocal.x, newLocal.y, newLocal.z);
    changedObjects.add(state.object);
  }

  for (const object of changedObjects) {
    const geometry = object.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals?.();
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
  }

  refreshComponentOverlays();
  refreshHoverOverlays();
  refreshInspector(false);
}

transform.addEventListener('mouseDown', () => {
  ignoreNextCanvasClick = true;
  if (editMode === 'object') {
    pendingTransformCommand = {
      type: 'object',
      before: captureObjectTransformStates(selectedObjects)
    };
    prepareMultiDrag();
  } else {
    pendingTransformCommand = {
      type: 'component',
      before: captureGeometryPositionStates(getActiveComponentObjects())
    };
    prepareComponentDrag();
  }
});
transform.addEventListener('objectChange', () => {
  if (editMode === 'object') {
    applyMultiDrag();
    refreshSceneTree();
  } else {
    applyComponentDrag();
  }
});
transform.addEventListener('mouseUp', () => {
  if (modelingToolSettings.snap.enabled) applySnapToSelection(false);
  if (pendingTransformCommand?.type === 'object') {
    const after = captureObjectTransformStates(selectedObjects);
    commandManager.record(new ObjectTransformCommand(pendingTransformCommand.before, after));
  } else if (pendingTransformCommand?.type === 'component') {
    const after = captureGeometryPositionStates(getActiveComponentObjects());
    commandManager.record(new ComponentGeometryCommand(pendingTransformCommand.before, after));
  }
  pendingTransformCommand = null;
  multiDragState = null;
  componentDragState = null;
  if (editMode === 'object' && selectedObjects.length > 1) placeObjectSelectionPivotAtCenter();
  if (editMode !== 'object' && getComponentSelectionCount() > 0) placeComponentSelectionPivotAtCenter();
  if (activePropertiesTool === 'extrude') {
    syncExtrudeAmountsFromGizmo();
    refreshToolProperties(true);
  }
  autoKeySelectedObjects();
  refreshObjectWireOverlays();
  refreshComponentOverlays();
  refreshInspector();
  window.setTimeout(() => { ignoreNextCanvasClick = false; }, 80);
});

function refreshSceneTree() {
  sceneTree.innerHTML = '';
  const roots = getEditorRoots();

  const rootDrop = document.createElement('div');
  rootDrop.className = 'tree-root-drop';
  rootDrop.textContent = 'Drop here to move selected/dragged object to Scene Root';
  rootDrop.addEventListener('dragover', event => {
    event.preventDefault();
    rootDrop.classList.add('drag-over');
  });
  rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('drag-over'));
  rootDrop.addEventListener('drop', event => {
    event.preventDefault();
    rootDrop.classList.remove('drag-over');
    const child = editorObjects.get(event.dataTransfer.getData('text/editor-object-id'));
    if (child && child.parent !== scene) commandManager.execute(new ParentObjectCommand(child, scene));
  });
  sceneTree.appendChild(rootDrop);

  if (!roots.length) {
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    empty.textContent = 'No editable objects in scene.';
    sceneTree.appendChild(empty);
    return;
  }

  for (const object of roots) renderSceneTreeNode(object, 0);
}

function renderSceneTreeNode(object, depth = 0) {
  const row = document.createElement('div');
  row.className = `tree-item${isSelected(object) ? ' selected' : ''}${object.visible === false ? ' hidden-object' : ''}${isObjectLocked(object, false) ? ' locked-object' : ''}`;
  row.dataset.id = object.userData.editorId;
  row.draggable = true;
  row.style.setProperty('--tree-depth', depth);

  const main = document.createElement('div');
  main.className = 'tree-main';

  const indent = document.createElement('span');
  indent.className = 'tree-indent';
  indent.textContent = getEditorChildren(object).length ? '▾' : '•';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = isSceneCameraObject(object) ? '📷' : object.isLight ? '💡' : object.isMesh ? '▣' : '◇';

  const textWrap = document.createElement('span');
  textWrap.className = 'tree-text';

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = object.name;
  name.title = 'Double-click to rename';
  name.addEventListener('dblclick', event => {
    event.stopPropagation();
    renameHierarchyObject(object);
  });

  const type = document.createElement('span');
  type.className = 'tree-type';
  type.textContent = object.userData.editorType || object.type;

  textWrap.append(name, type);
  main.append(indent, icon, textWrap);

  const actions = document.createElement('div');
  actions.className = 'tree-actions';

  const renameBtn = makeTreeActionButton('✎', 'Rename object', () => renameHierarchyObject(object));
  const visibleBtn = makeTreeActionButton(object.visible === false ? '🙈' : '👁', object.visible === false ? 'Show object' : 'Hide object', () => toggleHierarchyVisibility(object));
  const lockBtn = makeTreeActionButton(isObjectLocked(object, false) ? '🔒' : '🔓', isObjectLocked(object, false) ? 'Unlock object' : 'Lock object', () => toggleHierarchyLock(object));
  const duplicateBtn = makeTreeActionButton('⧉', 'Duplicate object', () => duplicateHierarchyObject(object));
  const deleteBtn = makeTreeActionButton('🗑', 'Delete object', () => deleteHierarchyObject(object));
  actions.append(renameBtn, visibleBtn, lockBtn, duplicateBtn, deleteBtn);

  row.append(main, actions);

  row.addEventListener('click', event => {
    if (event.target.closest('.tree-action')) return;
    if (editMode !== 'object') setEditMode('object');
    if (isObjectLocked(object)) {
      notify('This object is locked. Unlock it from Project Structure before selecting or transforming.');
      return;
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey) toggleSelection(object);
    else selectObjects([object]);
  });

  row.addEventListener('dragstart', event => {
    event.dataTransfer.setData('text/editor-object-id', object.userData.editorId);
    event.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragover', event => {
    const child = editorObjects.get(event.dataTransfer.getData('text/editor-object-id'));
    if (!child || child === object || hasEditorAncestor(object, child)) return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', event => {
    event.preventDefault();
    row.classList.remove('drag-over');
    const child = editorObjects.get(event.dataTransfer.getData('text/editor-object-id'));
    if (!child || child === object || hasEditorAncestor(object, child)) return;
    commandManager.execute(new ParentObjectCommand(child, object));
  });

  sceneTree.appendChild(row);
  for (const child of getEditorChildren(object)) renderSceneTreeNode(child, depth + 1);
}

function makeTreeActionButton(label, title, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tree-action';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  });
  return button;
}

function renameHierarchyObject(object) {
  if (!object) return;
  const nextName = window.prompt('Rename object', object.name || 'Object');
  if (nextName == null) return;
  commandManager.execute(new RenameObjectCommand(object, nextName));
}

function toggleHierarchyVisibility(object) {
  if (!object) return;
  commandManager.execute(new ObjectVisibilityCommand(object, object.visible === false));
}

function toggleHierarchyLock(object) {
  if (!object) return;
  commandManager.execute(new ObjectLockCommand(object, !isObjectLocked(object, false)));
}

function duplicateHierarchyObject(object) {
  if (!object) return;
  const previousSelection = [...selectedObjects];
  setEditMode('object', { keepSelection: true });
  selectObjects([object]);
  runDuplicateTool();
  if (previousSelection.length) selectObjects(previousSelection.filter(item => item.parent && !isObjectLocked(item)));
}

function deleteHierarchyObject(object) {
  if (!object) return;
  commandManager.execute(new DeleteObjectsCommand([object]));
}

function toFixed(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : '0.000';
}

function deg(rad) { return THREE.MathUtils.radToDeg(rad); }
function rad(degValue) { return THREE.MathUtils.degToRad(degValue); }

function createInput(label, value, onInput, type = 'number', step = '0.01') {
  const row = document.createElement('div');
  row.className = 'form-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  if (type === 'number') input.step = step;
  input.addEventListener('input', () => { onInput(input.value); handleEditorPropertyChanged(); });
  row.append(labelEl, input);
  return row;
}


function createSelectInput(label, value, options, onInput) {
  const row = document.createElement('div');
  row.className = 'form-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const select = document.createElement('select');
  for (const option of options) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    if (String(option.value) === String(value)) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('input', () => { onInput(select.value); handleEditorPropertyChanged(); });
  row.append(labelEl, select);
  return row;
}

function createCheckboxInput(label, checked, onInput) {
  const row = document.createElement('div');
  row.className = 'form-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.addEventListener('input', () => { onInput(input.checked); handleEditorPropertyChanged(); });
  row.append(labelEl, input);
  return row;
}

function getSingleSelectedMesh() {
  if (editMode === 'object' && selectedObjects.length === 1 && selectedObjects[0].isMesh) return selectedObjects[0];
  const refs = getSelectedComponentVertexRefs();
  if (refs.length) return refs[0].object;
  return null;
}

function getEditableMaterial(mesh) {
  const realMaterial = viewModeManager.getRealMaterial(mesh);
  if (!realMaterial) return null;
  if (Array.isArray(realMaterial)) return realMaterial[0] || null;
  return realMaterial;
}

function refreshMaterialAsset() {
  if (!materialAssetContent) return;
  materialAssetContent.innerHTML = '';
  const mesh = getSingleSelectedMesh();
  const material = getEditableMaterial(mesh);
  if (!mesh || !material) {
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    empty.textContent = 'Select one mesh object, face, edge, or vertex to edit its material asset.';
    materialAssetContent.appendChild(empty);
    return;
  }

  const previewRow = document.createElement('div');
  previewRow.className = 'material-preview-row';
  const swatch = document.createElement('div');
  swatch.className = 'material-swatch';
  swatch.style.background = material.map ? `url(${material.map.image?.src || ''}) center / cover` : (material.color ? `#${material.color.getHexString()}` : '#777777');
  const meta = document.createElement('div');
  const hasTexture = Boolean(material.map);
  meta.innerHTML = `<div class="asset-title">${mesh.name} Material</div><div class="asset-subtitle">${materialTypeLabel(material.type)}${hasTexture ? ' • texture applied' : ' • editable material properties'}</div>`;
  previewRow.append(swatch, meta);

  const grid = document.createElement('div');
  grid.className = 'form-grid';

  grid.appendChild(createSelectInput('Material Type', material.type || 'MeshStandardMaterial', MATERIAL_TYPES, value => {
    changeSelectedMeshMaterialType(mesh, value);
  }));

  grid.appendChild(createInput('Material Name', material.name || `${mesh.name} Material`, value => {
    material.name = value;
    material.needsUpdate = true;
  }, 'text'));

  if (material.color) {
    grid.appendChild(createInput('Base Color', `#${material.color.getHexString()}`, value => {
      material.color.set(value);
      material.needsUpdate = true;
      refreshObjectWireOverlays();
      refreshComponentOverlays();
      refreshMaterialAsset();
    }, 'color'));
  }

  if (material.emissive) {
    grid.appendChild(createInput('Emissive Color', `#${material.emissive.getHexString()}`, value => {
      material.emissive.set(value);
      material.needsUpdate = true;
    }, 'color'));
  }

  if (material.specular) {
    grid.appendChild(createInput('Specular Color', `#${material.specular.getHexString()}`, value => {
      material.specular.set(value);
      material.needsUpdate = true;
    }, 'color'));
  }

  if ('roughness' in material) grid.appendChild(createInput('Roughness', toFixed(material.roughness), value => {
    material.roughness = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('metalness' in material) grid.appendChild(createInput('Metalness', toFixed(material.metalness), value => {
    material.metalness = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('clearcoat' in material) grid.appendChild(createInput('Clearcoat', toFixed(material.clearcoat), value => {
    material.clearcoat = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('clearcoatRoughness' in material) grid.appendChild(createInput('Clearcoat Roughness', toFixed(material.clearcoatRoughness), value => {
    material.clearcoatRoughness = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('reflectivity' in material) grid.appendChild(createInput('Reflectivity', toFixed(material.reflectivity), value => {
    material.reflectivity = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('transmission' in material) grid.appendChild(createInput('Transmission', toFixed(material.transmission), value => {
    material.transmission = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.transparent = material.transmission > 0 || material.opacity < 1;
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('thickness' in material) grid.appendChild(createInput('Thickness', toFixed(material.thickness), value => {
    material.thickness = Math.max(0, parseFloat(value) || 0);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('ior' in material) grid.appendChild(createInput('IOR', toFixed(material.ior), value => {
    material.ior = THREE.MathUtils.clamp(parseFloat(value) || 1.5, 1, 2.333);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('shininess' in material) grid.appendChild(createInput('Shininess', toFixed(material.shininess), value => {
    material.shininess = Math.max(0, parseFloat(value) || 0);
    material.needsUpdate = true;
  }, 'number', '1'));

  if ('opacity' in material) grid.appendChild(createInput('Opacity', toFixed(material.opacity), value => {
    material.opacity = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.transparent = material.opacity < 1;
    material.needsUpdate = true;
    refreshMaterialAsset();
  }, 'number', '0.01'));

  if ('alphaTest' in material) grid.appendChild(createInput('Alpha Test', toFixed(material.alphaTest), value => {
    material.alphaTest = THREE.MathUtils.clamp(parseFloat(value) || 0, 0, 1);
    material.needsUpdate = true;
  }, 'number', '0.01'));

  if ('wireframe' in material) grid.appendChild(createCheckboxInput('Wireframe', Boolean(material.wireframe), value => {
    material.wireframe = value;
    material.needsUpdate = true;
  }));

  if ('transparent' in material) grid.appendChild(createCheckboxInput('Transparent', Boolean(material.transparent), value => {
    material.transparent = value;
    material.needsUpdate = true;
  }));

  if ('flatShading' in material) grid.appendChild(createCheckboxInput('Flat Shading', Boolean(material.flatShading), value => {
    material.flatShading = value;
    material.needsUpdate = true;
  }));

  grid.appendChild(createSelectInput('Render Side', material.side, [
    { value: THREE.FrontSide, label: 'Front Side' },
    { value: THREE.BackSide, label: 'Back Side' },
    { value: THREE.DoubleSide, label: 'Double Side' }
  ], value => { material.side = Number(value); material.needsUpdate = true; }));

  grid.appendChild(createTextureUploadInput(mesh, material));
  if (material.map) grid.appendChild(createRemoveTextureButton(mesh, material));

  materialAssetContent.append(previewRow, grid);
}

function changeSelectedMeshMaterialType(mesh, type) {
  const oldMaterial = getEditableMaterial(mesh);
  if (!mesh || !oldMaterial) return;
  const before = oldMaterial.clone?.() || oldMaterial;
  const oldMap = oldMaterial.map || null;
  const nextMaterial = createMaterialByType(type, {
    color: oldMaterial.color?.getHex?.() ?? 0x7db5ff,
    map: oldMap,
    side: oldMaterial.side,
    opacity: oldMaterial.opacity,
    transparent: oldMaterial.transparent,
    name: `${materialTypeLabel(type)} Asset`
  });
  mesh.material = nextMaterial;
  oldMaterial.dispose?.();
  refreshObjectWireOverlays();
  refreshComponentOverlays();
  refreshInspector(false);
  refreshMaterialAsset();
  commandManager.record(new MaterialAssetCommand(mesh, before, nextMaterial, `Apply ${materialTypeLabel(type)} Material`));
}

function applyTextureToMaterial(mesh, material, file) {
  if (!mesh || !material || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
      texture.needsUpdate = true;
      let targetMaterial = getEditableMaterial(mesh);
      const beforeMaterial = targetMaterial?.clone?.() || null;
      if (!materialSupportsTexture(targetMaterial)) {
        targetMaterial = createMaterialByType('MeshStandardMaterial', {
          color: 0xffffff,
          map: texture,
          name: 'Textured Standard Material'
        });
        const oldMaterial = mesh.material;
        mesh.material = targetMaterial;
        oldMaterial?.dispose?.();
      } else {
        targetMaterial.map?.dispose?.();
        targetMaterial.map = texture;
        if (targetMaterial.color) targetMaterial.color.set(0xffffff);
        targetMaterial.needsUpdate = true;
      }
      refreshObjectWireOverlays();
      refreshComponentOverlays();
      refreshInspector(false);
      refreshMaterialAsset();
      commandManager.record(new MaterialAssetCommand(mesh, beforeMaterial, targetMaterial, 'Apply Texture'));
      handleEditorPropertyChanged();
      notify(`Texture applied to ${mesh.name}.`);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function createTextureUploadInput(mesh, material) {
  const row = document.createElement('div');
  row.className = 'form-row texture-upload-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = 'Texture Upload';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) applyTextureToMaterial(mesh, material, file);
  });
  row.append(labelEl, input);
  return row;
}

function createRemoveTextureButton(mesh, material) {
  const row = document.createElement('div');
  row.className = 'form-row texture-upload-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = 'Texture';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'material-action-btn';
  button.textContent = 'Remove Texture';
  button.addEventListener('click', () => {
    const beforeMaterial = material.clone?.() || null;
    material.map?.dispose?.();
    material.map = null;
    material.needsUpdate = true;
    refreshMaterialAsset();
    refreshInspector(false);
    commandManager.record(new MaterialAssetCommand(mesh, beforeMaterial, material, 'Remove Texture'));
    handleEditorPropertyChanged();
  });
  row.append(labelEl, button);
  return row;
}

function propertyNumber(label, tool, key, step = '0.01', min = null, max = null) {
  const row = createInput(label, toFixed(modelingToolSettings[tool][key]), value => {
    let next = parseFloat(value) || 0;
    if (min != null || max != null) next = THREE.MathUtils.clamp(next, min ?? -Infinity, max ?? Infinity);
    modelingToolSettings[tool][key] = next;
    refreshToolProperties(false);
  }, 'number', step);
  const input = row.querySelector('input');
  if (input) {
    if (min != null) input.min = String(min);
    if (max != null) input.max = String(max);
  }
  return row;
}

function propertyRange(label, tool, key, min = -10, max = 10, step = '0.1') {
  const row = document.createElement('div');
  row.className = 'form-row range-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const wrap = document.createElement('div');
  wrap.className = 'range-control';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = step;
  range.value = String(modelingToolSettings[tool][key]);
  const number = document.createElement('input');
  number.type = 'number';
  number.min = String(min);
  number.max = String(max);
  number.step = step;
  number.value = toFixed(modelingToolSettings[tool][key]);
  const commit = value => {
    const next = THREE.MathUtils.clamp(parseFloat(value) || 0, min, max);
    modelingToolSettings[tool][key] = next;
    range.value = String(next);
    number.value = toFixed(next);
    if (tool === 'gridMeasure') syncGridMeasurementSettings();
  };
  range.addEventListener('input', () => commit(range.value));
  number.addEventListener('input', () => commit(number.value));
  wrap.append(range, number);
  row.append(labelEl, wrap);
  return row;
}


function propertyCheckbox(label, tool, key) {
  const row = document.createElement('div');
  row.className = 'form-row checkbox-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  const wrap = document.createElement('div');
  wrap.className = 'checkbox-control';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!modelingToolSettings[tool][key];
  checkbox.addEventListener('change', () => {
    modelingToolSettings[tool][key] = checkbox.checked;
  });
  wrap.appendChild(checkbox);
  row.append(labelEl, wrap);
  return row;
}


function propertyButton(label, onClick, className = 'action-btn') {
  const row = document.createElement('div');
  row.className = 'form-row property-button-row';
  const spacer = document.createElement('label');
  spacer.textContent = 'Action';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  row.append(spacer, button);
  return row;
}

function refreshToolProperties(rebuild = true) {
  if (!toolPropertiesContent) return;
  if (!rebuild && toolPropertiesContent.dataset.tool === activePropertiesTool) return;
  toolPropertiesContent.dataset.tool = activePropertiesTool;
  toolPropertiesContent.innerHTML = '';

  const help = document.createElement('div');
  help.className = 'property-help';
  const grid = document.createElement('div');
  grid.className = 'form-grid';

  if (activePropertiesTool === 'extrude') {
    help.innerHTML = '<strong>Extrude Properties</strong><br>Workflow: choose Face, Edge, or Vertex mode, select one or more components, run Extrude, then drag the attached Translate gizmo or edit Extrude Amount X/Y/Z. Enable Combine to merge only adjacent selected components during extrusion. In Face mode, faces combine only when they share a real edge. If Combine is off, every selected component extrudes independently even when adjacent. These values are clamped from -10 to 10.';
    grid.appendChild(extrudeAmountProperty('Extrude Amount X', 'amountX'));
    grid.appendChild(extrudeAmountProperty('Extrude Amount Y', 'amountY'));
    grid.appendChild(extrudeAmountProperty('Extrude Amount Z', 'amountZ'));
    grid.appendChild(propertyCheckbox('Combine', 'extrude', 'combine'));
  } else if (activePropertiesTool === 'bevel') {
    help.innerHTML = '<strong>Bevel Properties</strong><br>Offsets selected component vertices by the amount below. Use smaller values for subtle corner softening.';
    grid.appendChild(propertyNumber('Bevel Amount', 'bevel', 'amount'));
  } else if (activePropertiesTool === 'chamfer') {
    help.innerHTML = '<strong>Chamfer Properties</strong><br>Applies a stronger straight offset to selected Face, Edge, or Vertex components.';
    grid.appendChild(propertyNumber('Chamfer Amount', 'chamfer', 'amount'));
  } else if (activePropertiesTool === 'multicut') {
    help.innerHTML = '<strong>Multicut Properties</strong><br>This starter version splits every selected triangulated face through its center into three smaller triangles.';
    grid.appendChild(createSelectInput('Cut Mode', modelingToolSettings.multicut.mode, [{ value: 'center-split', label: 'Center Split' }], value => { modelingToolSettings.multicut.mode = value; }));
  } else if (activePropertiesTool === 'mirror') {
    help.innerHTML = '<strong>Mirror Properties</strong><br>In Object mode this creates a mirrored duplicate. In component modes it appends mirrored selected component geometry.';
    grid.appendChild(createSelectInput('Mirror Axis', modelingToolSettings.mirror.axis, [
      { value: 'x', label: 'X Axis' },
      { value: 'y', label: 'Y Axis' },
      { value: 'z', label: 'Z Axis' }
    ], value => { modelingToolSettings.mirror.axis = value; }));
  } else if (activePropertiesTool === 'delete') {
    help.innerHTML = '<strong>Delete Tool</strong><br>Deletes the selected objects or selected Face/Edge/Vertex components. Component delete removes affected triangles and is undoable.';
    grid.appendChild(propertyButton('Delete Selection', runDeleteTool, 'danger-btn'));
  } else if (activePropertiesTool === 'duplicate') {
    help.innerHTML = '<strong>Duplicate Tool</strong><br>Duplicate selected objects or selected components. Shortcut: Ctrl+D.';
    grid.appendChild(propertyNumber('Offset X', 'duplicate', 'offsetX', '0.01', -10, 10));
    grid.appendChild(propertyNumber('Offset Y', 'duplicate', 'offsetY', '0.01', -10, 10));
    grid.appendChild(propertyNumber('Offset Z', 'duplicate', 'offsetZ', '0.01', -10, 10));
    grid.appendChild(propertyButton('Duplicate Now', runDuplicateTool));
  } else if (activePropertiesTool === 'snap') {
    help.innerHTML = '<strong>Snap Tool</strong><br>When enabled, selected objects/components snap after gizmo movement. Use Apply Snap to snap immediately.';
    grid.appendChild(propertyCheckbox('Snap Enabled', 'snap', 'enabled'));
    grid.appendChild(propertyNumber('Grid Size', 'snap', 'gridSize', '0.01', 0.01, 10));
    grid.appendChild(propertyNumber('Rotation Step Degrees', 'snap', 'rotationStep', '1', 1, 90));
    grid.appendChild(propertyNumber('Scale Step', 'snap', 'scaleStep', '0.01', 0.01, 10));
    grid.appendChild(propertyButton('Apply Snap Now', () => applySnapToSelection('force')));
  } else if (activePropertiesTool === 'align') {
    help.innerHTML = '<strong>Align Tool</strong><br>Align multiple selected objects or component vertices along one axis using Min, Center, or Max.';
    grid.appendChild(createSelectInput('Axis', modelingToolSettings.align.axis, [{ value:'x', label:'X' }, { value:'y', label:'Y' }, { value:'z', label:'Z' }], value => { modelingToolSettings.align.axis = value; }));
    grid.appendChild(createSelectInput('Align To', modelingToolSettings.align.alignTo, [{ value:'min', label:'Minimum' }, { value:'center', label:'Center' }, { value:'max', label:'Maximum' }], value => { modelingToolSettings.align.alignTo = value; }));
    grid.appendChild(propertyButton('Apply Align', applyAlignToSelection));
  } else if (activePropertiesTool === 'uvMapping') {
    help.innerHTML = '<strong>UV Mapping Tool</strong><br>Generate UV coordinates for selected mesh objects/components. Use this before texture upload/control for better texture placement.';
    grid.appendChild(createSelectInput('Projection', modelingToolSettings.uvMapping.projection, [
      { value:'box', label:'Box Projection' },
      { value:'planar-xz', label:'Planar XZ' },
      { value:'planar-xy', label:'Planar XY' },
      { value:'spherical', label:'Spherical' },
      { value:'cylindrical', label:'Cylindrical' }
    ], value => { modelingToolSettings.uvMapping.projection = value; }));
    grid.appendChild(propertyNumber('Repeat U', 'uvMapping', 'repeatU', '0.01', 0.01, 50));
    grid.appendChild(propertyNumber('Repeat V', 'uvMapping', 'repeatV', '0.01', 0.01, 50));
    grid.appendChild(propertyNumber('Offset U', 'uvMapping', 'offsetU', '0.01', -10, 10));
    grid.appendChild(propertyNumber('Offset V', 'uvMapping', 'offsetV', '0.01', -10, 10));
    grid.appendChild(propertyNumber('UV Rotation Degrees', 'uvMapping', 'rotation', '1', -360, 360));
    grid.appendChild(propertyButton('Apply UV Mapping', applyUVMappingToSelection));
  } else if (activePropertiesTool === 'textureControls') {
    help.innerHTML = '<strong>Texture Controls</strong><br>Adjust uploaded texture repeat, offset, rotation, wrapping, and FlipY on the selected mesh material.';
    grid.appendChild(propertyNumber('Repeat U', 'textureControls', 'repeatU', '0.01', 0.01, 50));
    grid.appendChild(propertyNumber('Repeat V', 'textureControls', 'repeatV', '0.01', 0.01, 50));
    grid.appendChild(propertyNumber('Offset U', 'textureControls', 'offsetU', '0.01', -10, 10));
    grid.appendChild(propertyNumber('Offset V', 'textureControls', 'offsetV', '0.01', -10, 10));
    grid.appendChild(propertyNumber('Rotation Degrees', 'textureControls', 'rotation', '1', -360, 360));
    grid.appendChild(createSelectInput('Wrap Mode', modelingToolSettings.textureControls.wrap, [
      { value:'RepeatWrapping', label:'Repeat' },
      { value:'ClampToEdgeWrapping', label:'Clamp to Edge' },
      { value:'MirroredRepeatWrapping', label:'Mirrored Repeat' }
    ], value => { modelingToolSettings.textureControls.wrap = value; }));
    grid.appendChild(propertyCheckbox('Flip Y', 'textureControls', 'flipY'));
    grid.appendChild(propertyButton('Apply Texture Controls', applyTextureControlsToSelection));
  } else if (activePropertiesTool === 'multiMaterial') {
    help.innerHTML = '<strong>Multi-material Face Assignment</strong><br>Switch to Face mode, select faces, then apply a separate material to only those selected faces.';
    grid.appendChild(createSelectInput('Material Type', modelingToolSettings.multiMaterial.materialType, MATERIAL_TYPES, value => { modelingToolSettings.multiMaterial.materialType = value; }));
    grid.appendChild(createInput('Material Name', modelingToolSettings.multiMaterial.materialName, value => { modelingToolSettings.multiMaterial.materialName = value; }, 'text'));
    grid.appendChild(createInput('Face Material Color', modelingToolSettings.multiMaterial.color, value => { modelingToolSettings.multiMaterial.color = value; }, 'color'));
    grid.appendChild(propertyButton('Assign Material To Faces', applyMultiMaterialToSelection));
  } else if (activePropertiesTool === 'array') {
    help.innerHTML = '<strong>Array Tool</strong><br>Create linear or circular repeated copies of selected objects. Count includes the original when Include Original is enabled.';
    grid.appendChild(createSelectInput('Array Mode', modelingToolSettings.array.mode, [{ value:'linear', label:'Linear' }, { value:'circular', label:'Circular' }], value => { modelingToolSettings.array.mode = value; refreshToolProperties(true); }));
    grid.appendChild(propertyNumber('Count', 'array', 'count', '1', 1, 100));
    grid.appendChild(propertyCheckbox('Include Original', 'array', 'includeOriginal'));
    if (modelingToolSettings.array.mode === 'linear') {
      grid.appendChild(propertyNumber('Offset X', 'array', 'offsetX', '0.01', -20, 20));
      grid.appendChild(propertyNumber('Offset Y', 'array', 'offsetY', '0.01', -20, 20));
      grid.appendChild(propertyNumber('Offset Z', 'array', 'offsetZ', '0.01', -20, 20));
    } else {
      grid.appendChild(createSelectInput('Axis', modelingToolSettings.array.axis, [{ value:'x', label:'X' }, { value:'y', label:'Y' }, { value:'z', label:'Z' }], value => { modelingToolSettings.array.axis = value; }));
      grid.appendChild(propertyNumber('Radius', 'array', 'radius', '0.01', 0.01, 50));
      grid.appendChild(propertyNumber('Angle Degrees', 'array', 'angle', '1', 1, 360));
    }
    grid.appendChild(propertyButton('Apply Array', applyArrayTool));
  } else if (activePropertiesTool === 'gridMeasure') {
    help.innerHTML = '<strong>Grid and Measurement Tools</strong><br>Set the editor grid size/unit system, then choose Distance, Angle, or Ruler. Click two points for distance/ruler; click three points for angle. Points can be on mesh surfaces or the ground grid.';
    grid.appendChild(propertyNumber('Grid Size', 'gridMeasure', 'gridSize', '1', 1, 200));
    grid.appendChild(propertyNumber('Grid Divisions', 'gridMeasure', 'gridDivisions', '1', 1, 200));
    grid.appendChild(createSelectInput('Unit System', modelingToolSettings.gridMeasure.unitSystem, [
      { value:'meter', label:'Meters (m)' },
      { value:'centimeter', label:'Centimeters (cm)' },
      { value:'millimeter', label:'Millimeters (mm)' },
      { value:'inch', label:'Inches (in)' },
      { value:'foot', label:'Feet (ft)' }
    ], value => { modelingToolSettings.gridMeasure.unitSystem = value; syncGridMeasurementSettings(); }));
    grid.appendChild(createSelectInput('Measure Mode', modelingToolSettings.gridMeasure.mode, [
      { value:'distance', label:'Distance Measurement' },
      { value:'angle', label:'Angle Measurement' },
      { value:'ruler', label:'Ruler Tool' }
    ], value => { modelingToolSettings.gridMeasure.mode = value; syncGridMeasurementSettings(); }));
    grid.appendChild(propertyButton('Apply Grid Settings', syncGridMeasurementSettings));
    grid.appendChild(propertyButton('Clear Measurements', () => gridMeasurementManager.clearMeasurements(), 'danger-btn'));
  } else if (['translate','rotate','scale'].includes(activePropertiesTool)) {
    help.innerHTML = `<strong>${capitalize(activePropertiesTool)} Tool</strong><br>The transform gizmo is visible. Select objects or components and drag the gizmo in the viewport.`;
  } else {
    help.innerHTML = '<strong>Select Tool</strong><br>Gizmo is hidden. Click or drag-select objects/components. Use Shift+click or Shift+drag to add to the current selection.';
  }
  toolPropertiesContent.append(help, grid);
}


function getAnimationObjectId(object) {
  return object?.userData?.editorId || null;
}

function clonePlain(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice();
  const out = {};
  for (const [key, val] of Object.entries(value)) out[key] = clonePlain(val);
  return out;
}

function captureMaterialAnimState(material) {
  if (!material) return null;
  const state = {
    type: material.type,
    side: material.side,
    opacity: 'opacity' in material ? material.opacity : 1,
    transparent: Boolean(material.transparent),
    wireframe: Boolean(material.wireframe),
    flatShading: Boolean(material.flatShading)
  };
  if (material.color) state.color = material.color.getHex();
  if (material.emissive) state.emissive = material.emissive.getHex();
  if (material.specular) state.specular = material.specular.getHex();
  for (const key of ['roughness','metalness','clearcoat','clearcoatRoughness','reflectivity','transmission','thickness','ior','shininess','alphaTest']) {
    if (key in material && typeof material[key] === 'number') state[key] = material[key];
  }
  if (material.map?.image?.src) state.mapSrc = material.map.image.src;
  return state;
}

function captureAnimatableState(object) {
  const state = {
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
    visible: object.visible !== false
  };
  if (object.isMesh) {
    const material = getEditableMaterial(object);
    state.material = captureMaterialAnimState(material);
    const pos = object.geometry?.attributes?.position;
    if (pos?.array) state.geometryPositions = Array.from(pos.array);
  }
  if (isSceneCameraObject(object)) {
    state.camera = {
      fov: object.fov ?? 50,
      zoom: object.zoom ?? 1,
      near: object.near ?? 0.1,
      far: object.far ?? 1000,
      orthoSize: object.userData?.orthoSize ?? 6
    };
  }
  if (object.isLight) {
    state.light = {
      intensity: object.intensity ?? 1,
      color: object.color?.getHex?.() ?? 0xffffff
    };
  }
  return state;
}

function applyMaterialAnimState(material, state) {
  if (!material || !state) return;
  if (material.color && state.color != null) material.color.setHex(state.color);
  if (material.emissive && state.emissive != null) material.emissive.setHex(state.emissive);
  if (material.specular && state.specular != null) material.specular.setHex(state.specular);
  for (const key of ['roughness','metalness','clearcoat','clearcoatRoughness','reflectivity','transmission','thickness','ior','shininess','alphaTest','opacity']) {
    if (key in material && state[key] != null) material[key] = state[key];
  }
  if ('transparent' in material && state.transparent != null) material.transparent = Boolean(state.transparent);
  if ('wireframe' in material && state.wireframe != null) material.wireframe = Boolean(state.wireframe);
  if ('flatShading' in material && state.flatShading != null) material.flatShading = Boolean(state.flatShading);
  if ('side' in material && state.side != null) material.side = Number(state.side);
  material.needsUpdate = true;
}

function applyAnimatableState(object, state) {
  if (!object || !state) return;
  if (state.position) object.position.set(state.position.x, state.position.y, state.position.z);
  if (state.rotation) object.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  if (state.scale) object.scale.set(state.scale.x, state.scale.y, state.scale.z);
  if (state.visible != null) object.visible = Boolean(state.visible);
  if (object.isMesh) {
    let targetMaterial = getEditableMaterial(object);
    if (state.material?.type && targetMaterial && targetMaterial.type !== state.material.type && typeof createMaterialByType === 'function') {
      const replacement = createMaterialByType(state.material.type, {
        color: state.material.color ?? targetMaterial.color?.getHex?.() ?? 0x7db5ff,
        opacity: state.material.opacity ?? targetMaterial.opacity ?? 1,
        transparent: state.material.transparent ?? targetMaterial.transparent ?? false,
        side: state.material.side ?? targetMaterial.side,
        name: targetMaterial.name || `${state.material.type} Animated Material`
      });
      object.material = replacement;
      targetMaterial.dispose?.();
      targetMaterial = replacement;
    }
    applyMaterialAnimState(targetMaterial, state.material);
    const pos = object.geometry?.attributes?.position;
    if (pos?.array && state.geometryPositions && state.geometryPositions.length === pos.array.length) {
      pos.array.set(state.geometryPositions);
      pos.needsUpdate = true;
      object.geometry.computeVertexNormals?.();
      object.geometry.computeBoundingBox?.();
      object.geometry.computeBoundingSphere?.();
    }
  }
  if (isSceneCameraObject(object) && state.camera) {
    if (object.isPerspectiveCamera && state.camera.fov != null) object.fov = Number(state.camera.fov);
    if (state.camera.zoom != null) object.zoom = Number(state.camera.zoom);
    if (state.camera.near != null) object.near = Number(state.camera.near);
    if (state.camera.far != null) object.far = Number(state.camera.far);
    if (object.isOrthographicCamera && state.camera.orthoSize != null) {
      object.userData.orthoSize = Number(state.camera.orthoSize);
      updateOrthographicCameraBounds(object);
    }
    object.updateProjectionMatrix?.();
  }
  if (object.isLight && state.light) {
    if (state.light.intensity != null) object.intensity = state.light.intensity;
    if (object.color && state.light.color != null) object.color.setHex(state.light.color);
  }
  object.updateMatrixWorld(true);
}

function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

function lerpColorHex(a, b, t) {
  const ca = new THREE.Color(a ?? 0xffffff);
  const cb = new THREE.Color(b ?? a ?? 0xffffff);
  ca.lerp(cb, t);
  return ca.getHex();
}

function interpolateVectorState(a = {}, b = {}, t) {
  return {
    x: lerpNumber(Number(a.x) || 0, Number(b.x) || 0, t),
    y: lerpNumber(Number(a.y) || 0, Number(b.y) || 0, t),
    z: lerpNumber(Number(a.z) || 0, Number(b.z) || 0, t)
  };
}

function interpolateMaterialState(a, b, t) {
  if (!a && !b) return null;
  if (!a) return clonePlain(b);
  if (!b) return clonePlain(a);
  const out = clonePlain(t < 0.5 ? a : b);
  for (const key of ['opacity','roughness','metalness','clearcoat','clearcoatRoughness','reflectivity','transmission','thickness','ior','shininess','alphaTest']) {
    if (a[key] != null || b[key] != null) out[key] = lerpNumber(Number(a[key] ?? b[key] ?? 0), Number(b[key] ?? a[key] ?? 0), t);
  }
  if (a.color != null || b.color != null) out.color = lerpColorHex(a.color, b.color, t);
  if (a.emissive != null || b.emissive != null) out.emissive = lerpColorHex(a.emissive, b.emissive, t);
  if (a.specular != null || b.specular != null) out.specular = lerpColorHex(a.specular, b.specular, t);
  out.transparent = t < 0.5 ? Boolean(a.transparent) : Boolean(b.transparent);
  out.wireframe = t < 0.5 ? Boolean(a.wireframe) : Boolean(b.wireframe);
  out.flatShading = t < 0.5 ? Boolean(a.flatShading) : Boolean(b.flatShading);
  out.side = t < 0.5 ? a.side : b.side;
  return out;
}

function interpolateAnimatableState(a, b, t) {
  if (!a && !b) return null;
  if (!a) return clonePlain(b);
  if (!b) return clonePlain(a);
  const out = {
    position: interpolateVectorState(a.position, b.position, t),
    rotation: interpolateVectorState(a.rotation, b.rotation, t),
    scale: interpolateVectorState(a.scale, b.scale, t),
    visible: t < 0.5 ? Boolean(a.visible) : Boolean(b.visible),
    material: interpolateMaterialState(a.material, b.material, t)
  };
  if (a.light || b.light) {
    out.light = {
      intensity: lerpNumber(Number(a.light?.intensity ?? b.light?.intensity ?? 1), Number(b.light?.intensity ?? a.light?.intensity ?? 1), t),
      color: lerpColorHex(a.light?.color, b.light?.color, t)
    };
  }
  if (a.camera || b.camera) {
    out.camera = {
      fov: lerpNumber(Number(a.camera?.fov ?? b.camera?.fov ?? 50), Number(b.camera?.fov ?? a.camera?.fov ?? 50), t),
      zoom: lerpNumber(Number(a.camera?.zoom ?? b.camera?.zoom ?? 1), Number(b.camera?.zoom ?? a.camera?.zoom ?? 1), t),
      near: lerpNumber(Number(a.camera?.near ?? b.camera?.near ?? 0.1), Number(b.camera?.near ?? a.camera?.near ?? 0.1), t),
      far: lerpNumber(Number(a.camera?.far ?? b.camera?.far ?? 1000), Number(b.camera?.far ?? a.camera?.far ?? 1000), t),
      orthoSize: lerpNumber(Number(a.camera?.orthoSize ?? b.camera?.orthoSize ?? 6), Number(b.camera?.orthoSize ?? a.camera?.orthoSize ?? 6), t)
    };
  }
  if (a.geometryPositions && b.geometryPositions && a.geometryPositions.length === b.geometryPositions.length) {
    out.geometryPositions = a.geometryPositions.map((value, index) => lerpNumber(value, b.geometryPositions[index], t));
  } else {
    out.geometryPositions = clonePlain(t < 0.5 ? a.geometryPositions : b.geometryPositions);
  }
  return out;
}

function getAnimationRecord(object) {
  const id = getAnimationObjectId(object);
  if (!id) return null;
  let record = animationState.tracks.get(id);
  if (!record) {
    record = { objectId: id, object, name: object.name || object.type, keys: [] };
    animationState.tracks.set(id, record);
  }
  record.object = object;
  record.name = object.name || record.name;
  return record;
}

function setAnimationKey(object, frame = animationState.currentFrame, state = captureAnimatableState(object)) {
  const record = getAnimationRecord(object);
  if (!record) return;
  const keyFrame = Math.round(THREE.MathUtils.clamp(Number(frame) || 0, 0, animationState.totalFrames));
  const existing = record.keys.find(key => key.frame === keyFrame);
  if (existing) existing.state = clonePlain(state);
  else record.keys.push({ frame: keyFrame, state: clonePlain(state) });
  record.keys.sort((a, b) => a.frame - b.frame);
}


function getSelectedDopeSheetObjects() {
  const objects = new Set();
  if (editMode === 'object') {
    for (const object of selectedObjects) if (object && !object.userData?.internal) objects.add(object);
  } else {
    for (const ref of getSelectedComponentVertexRefs()) if (ref.object && !ref.object.userData?.internal) objects.add(ref.object);
  }
  return [...objects];
}

function getPrimaryDopeSheetRecord() {
  const object = getSelectedDopeSheetObjects()[0];
  if (!object) return null;
  const id = getAnimationObjectId(object);
  if (!id) return null;
  const record = animationState.tracks.get(id) || null;
  if (record) {
    record.object = object;
    record.name = object.name || record.name;
  }
  return record;
}

function keyHasDopeSheetRow(key, row) {
  return Boolean(row.available?.(key?.state));
}

function getDopeSheetRowsForRecord(record) {
  if (!record?.keys?.length) return DOPESHEET_ROWS.slice(0, 3);
  return DOPESHEET_ROWS.filter(row => record.keys.some(key => keyHasDopeSheetRow(key, row)) || ['position','rotation','scale'].includes(row.id));
}

function moveAnimationKey(record, oldFrame, newFrame) {
  if (!record) return false;
  const from = Math.round(THREE.MathUtils.clamp(Number(oldFrame) || 0, 0, animationState.totalFrames));
  const to = Math.round(THREE.MathUtils.clamp(Number(newFrame) || 0, 0, animationState.totalFrames));
  if (from === to) return false;

  const keyIndex = record.keys.findIndex(key => key.frame === from);
  if (keyIndex < 0) return false;
  const [key] = record.keys.splice(keyIndex, 1);
  key.frame = to;

  const existingIndex = record.keys.findIndex(item => item.frame === to);
  if (existingIndex >= 0) record.keys.splice(existingIndex, 1, key);
  else record.keys.push(key);

  record.keys.sort((a, b) => a.frame - b.frame);
  refreshAnimationPanel(false);
  notify(`Animation key moved from frame ${from} to ${to}.`);
  return true;
}

function deleteAnimationKey(record, frame) {
  if (!record) return false;
  const targetFrame = Math.round(THREE.MathUtils.clamp(Number(frame) || 0, 0, animationState.totalFrames));
  const before = record.keys.length;
  record.keys = record.keys.filter(key => key.frame !== targetFrame);
  if (record.keys.length === before) return false;
  refreshAnimationPanel(false);
  notify(`Animation key deleted at frame ${targetFrame}.`);
  return true;
}

function createAnimationKeyDot(record, key, start, end, extraClass = '') {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = `animation-key-dot ${extraClass}`.trim();
  dot.title = `${record.name} key at frame ${key.frame}. Drag to move. Double-click or right-click to delete.`;
  dot.style.left = `${((key.frame - start) / Math.max(1, end - start)) * 100}%`;

  dot.addEventListener('click', event => {
    event.stopPropagation();
    applyAnimationFrame(key.frame);
  });

  dot.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
    deleteAnimationKey(record, key.frame);
  });

  dot.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    deleteAnimationKey(record, key.frame);
  });

  dot.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const originalFrame = key.frame;
    let previewFrame = originalFrame;
    dot.classList.add('dragging');

    const updatePreview = moveEvent => {
      const frame = frameFromTimelinePointer(moveEvent, animationState, getAnimationVisibleRange());
      previewFrame = frame;
      const { start: liveStart, end: liveEnd } = getAnimationVisibleRange();
      dot.style.left = `${((frame - liveStart) / Math.max(1, liveEnd - liveStart)) * 100}%`;
      if (animationState.ui.frameNumber) animationState.ui.frameNumber.value = String(frame);
    };

    const finish = () => {
      dot.classList.remove('dragging');
      document.removeEventListener('pointermove', updatePreview, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
      if (previewFrame !== originalFrame) moveAnimationKey(record, originalFrame, previewFrame);
      else refreshAnimationPanel(false);
    };

    document.addEventListener('pointermove', updatePreview, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
  });

  return dot;
}

function renderDopeSheet(records, start, end) {
  const wrap = document.createElement('div');
  wrap.className = 'dope-sheet-wrap';

  const record = getPrimaryDopeSheetRecord();
  if (!record) {
    wrap.innerHTML = `
      <div class="dope-sheet-header">
        <strong>Dope Sheet</strong>
        <span>Select an animated object to view Position, Rotation, Scale, Material Color, and Opacity rows.</span>
      </div>
    `;
    return wrap;
  }

  const hasKeys = record.keys.length > 0;
  const header = document.createElement('div');
  header.className = 'dope-sheet-header';
  header.innerHTML = `
    <strong>Dope Sheet: ${escapeHtml(record.name || 'Selected Object')}</strong>
    <span>${hasKeys ? 'Drag diamonds to move keys. Double-click or right-click a diamond to delete the full object key at that frame.' : 'No keys yet for selected object. Click Add Key to create the first key.'}</span>
  `;
  wrap.appendChild(header);

  const rows = getDopeSheetRowsForRecord(record);
  for (const rowDef of rows) {
    const row = document.createElement('div');
    row.className = 'animation-track-row dope-sheet-row';

    const label = document.createElement('div');
    label.className = 'animation-track-label dope-sheet-label';
    label.innerHTML = `<span class="dope-row-icon">${rowDef.icon}</span><span>${rowDef.label}</span>`;

    const lane = document.createElement('div');
    lane.className = 'animation-track-lane dope-sheet-lane';
    const laneHead = document.createElement('div');
    laneHead.className = 'animation-lane-playhead';
    laneHead.dataset.animPlayhead = 'lane';
    laneHead.style.left = `${((animationState.currentFrame - start) / Math.max(1, end - start)) * 100}%`;
    lane.appendChild(laneHead);

    for (const key of record.keys) {
      if (key.frame < start || key.frame > end) continue;
      if (!keyHasDopeSheetRow(key, rowDef)) continue;
      lane.appendChild(createAnimationKeyDot(record, key, start, end, 'dope-key-dot'));
    }

    row.append(label, lane);
    wrap.appendChild(row);
  }

  return wrap;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getAnimatableObjectsFromSelection() {
  const objects = new Set();
  if (editMode === 'object') {
    for (const object of selectedObjects) if (object && !object.userData?.internal) objects.add(object);
  } else {
    for (const ref of getSelectedComponentVertexRefs()) if (ref.object && !ref.object.userData?.internal) objects.add(ref.object);
  }
  return [...objects];
}

function captureAnimationSelectionBaselines() {
  if (animationState.applying) return;
  for (const object of getAnimatableObjectsFromSelection()) {
    const id = getAnimationObjectId(object);
    if (id) animationState.baselines.set(id, captureAnimatableState(object));
  }
}

function ensureFrameZeroKey(object) {
  const id = getAnimationObjectId(object);
  if (!id) return;
  const record = getAnimationRecord(object);
  if (!record || record.keys.some(key => key.frame === 0)) return;
  const base = animationState.baselines.get(id) || captureAnimatableState(object);
  setAnimationKey(object, 0, base);
}

function autoKeySelectedObjects() {
  if (!animationState.autoKey || animationState.applying || animationState.playing) return;
  const objects = getAnimatableObjectsFromSelection();
  if (!objects.length) return;
  for (const object of objects) {
    if (animationState.currentFrame !== 0) ensureFrameZeroKey(object);
    setAnimationKey(object, animationState.currentFrame, captureAnimatableState(object));
  }
  refreshAnimationPanel(false);
}

function handleEditorPropertyChanged() {
  autoKeySelectedObjects();
}


function captureAnimationKeySnapshot(objects) {
  const snapshot = [];
  for (const object of objects) {
    const id = getAnimationObjectId(object);
    if (!id) continue;
    const record = animationState.tracks.get(id);
    snapshot.push({ objectId: id, object, name: object.name || object.type, keys: clonePlain(record?.keys || []) });
  }
  return snapshot;
}

function applyAnimationKeySnapshot(snapshot) {
  for (const item of snapshot || []) {
    if (!item?.objectId) continue;
    if (!item.keys?.length) {
      animationState.tracks.delete(item.objectId);
      continue;
    }
    animationState.tracks.set(item.objectId, {
      objectId: item.objectId,
      object: item.object,
      name: item.object?.name || item.name || item.objectId,
      keys: clonePlain(item.keys)
    });
  }
}

function addAnimationKeyForCurrentSelection() {
  const objects = getAnimatableObjectsFromSelection();
  if (!objects.length) {
    notify('Animation: select one object or component before adding a key. Existing animations can still play without selection.');
    return;
  }
  const before = captureAnimationKeySnapshot(objects);
  for (const object of objects) {
    if (animationState.currentFrame !== 0) ensureFrameZeroKey(object);
    setAnimationKey(object, animationState.currentFrame, captureAnimatableState(object));
  }
  const after = captureAnimationKeySnapshot(objects);
  commandManager.record(new AnimationKeysCommand(before, after, `Add Keyframe at Frame ${Math.round(animationState.currentFrame)}`));
  refreshAnimationPanel(false);
  notify(`Animation key added at frame ${Math.round(animationState.currentFrame)} for ${objects.length} object${objects.length === 1 ? '' : 's'}.`);
}

function evaluateAnimationRecord(record, frame) {
  if (!record?.keys?.length) return null;
  const keys = record.keys;
  if (frame <= keys[0].frame) return clonePlain(keys[0].state);
  if (frame >= keys[keys.length - 1].frame) return clonePlain(keys[keys.length - 1].state);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const span = Math.max(1e-6, b.frame - a.frame);
      const t = (frame - a.frame) / span;
      return interpolateAnimatableState(a.state, b.state, t);
    }
  }
  return clonePlain(keys[keys.length - 1].state);
}

function applyAnimationFrame(frame) {
  animationState.currentFrame = THREE.MathUtils.clamp(Number(frame) || 0, 0, animationState.totalFrames);
  animationState.applying = true;
  try {
    for (const record of animationState.tracks.values()) {
      const object = editorObjects.get(record.objectId) || record.object;
      if (!object) continue;
      record.object = object;
      const state = evaluateAnimationRecord(record, animationState.currentFrame);
      if (state) applyAnimatableState(object, state);
    }
  } finally {
    animationState.applying = false;
  }
  refreshObjectWireOverlays();
  refreshComponentOverlays();
  if (!animationState.playing) {
    refreshInspector(false);
    refreshMaterialAsset();
  }
  updateAnimationUI(false);
}

function setAnimationPlaying(playing) {
  animationState.playing = Boolean(playing);
  animationState.lastTimestamp = null;
  updateAnimationUI(false);
}

function stopAnimationPlayback() {
  animationState.playing = false;
  animationState.lastTimestamp = null;
  applyAnimationFrame(0);
}

function updateAnimationPlayback(timestamp) {
  if (!animationState.playing) return;
  if (animationState.lastTimestamp == null) {
    animationState.lastTimestamp = timestamp;
    return;
  }
  const deltaSeconds = Math.min(0.1, Math.max(0, (timestamp - animationState.lastTimestamp) / 1000));
  animationState.lastTimestamp = timestamp;
  const nextFrame = animationState.currentFrame + deltaSeconds * animationState.fps * animationState.speed;
  if (nextFrame >= animationState.totalFrames) {
    applyAnimationFrame(animationState.totalFrames);
    setAnimationPlaying(false);
    return;
  }
  applyAnimationFrame(nextFrame);
}

function getAnimationVisibleRange() {
  return getStableAnimationVisibleRange(animationState);
}


function frameFromTimelinePointerEvent(event) {
  return frameFromTimelinePointer(event, animationState, getAnimationVisibleRange());
}

function scrubAnimationTimeline(event) {
  applyAnimationFrame(frameFromTimelinePointerEvent(event));
}

function handleAnimationTimelinePointerDown(event) {
  if (event.button !== 0) return;
  if (event.target?.closest?.('.animation-key-dot, .animation-track-label')) return;
  event.preventDefault();
  animationState.timelineScrubbing = true;
  scrubAnimationTimeline(event);

  const onMove = moveEvent => {
    if (!animationState.timelineScrubbing) return;
    moveEvent.preventDefault();
    scrubAnimationTimeline(moveEvent);
  };

  const onUp = () => {
    animationState.timelineScrubbing = false;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
}

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase?.();
  return Boolean(target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select');
}

function buildAnimationPanel() {
  if (!animationContent) return;
  animationContent.innerHTML = `
    <div class="animation-toolbar">
      <button type="button" class="anim-btn" data-anim-play>▶ Play</button>
      <button type="button" class="anim-btn" data-anim-stop>■ Stop</button>
      <label class="anim-field">Speed <input type="number" min="0.1" max="4" step="0.1" data-anim-speed></label>
      <label class="anim-field anim-zoom-field">Zoom <input type="range" min="0" max="100" step="1" data-anim-zoom></label>
      <button type="button" class="anim-btn" data-anim-add-key>◆ Add Key</button>
      <button type="button" class="anim-btn active" data-anim-auto-key>● Auto Key</button>
      <label class="anim-field frame-field">Frame <input type="number" min="0" data-anim-frame-number></label>
    </div>
    <div class="animation-timeline" data-anim-timeline>
      <div class="animation-ruler" data-anim-ruler></div>
      <div class="animation-track-list" data-anim-tracks></div>
    </div>
    <div class="animation-help">
      Select an object, enable Auto Key, set frame 0, add/change a property, move to another frame, change the property again, then press Play. Scrub directly on the timeline ruler/track area. Spacebar toggles Play/Pause. Animation playback applies all keyed objects even when nothing is selected. Dope Sheet rows show selected-object keys; drag keys to move and double-click/right-click to delete.
    </div>
  `;
  const ui = animationState.ui = {
    play: animationContent.querySelector('[data-anim-play]'),
    stop: animationContent.querySelector('[data-anim-stop]'),
    speed: animationContent.querySelector('[data-anim-speed]'),
    zoom: animationContent.querySelector('[data-anim-zoom]'),
    addKey: animationContent.querySelector('[data-anim-add-key]'),
    autoKey: animationContent.querySelector('[data-anim-auto-key]'),
    timeline: animationContent.querySelector('[data-anim-timeline]'),
    frameNumber: animationContent.querySelector('[data-anim-frame-number]'),
    ruler: animationContent.querySelector('[data-anim-ruler]'),
    tracks: animationContent.querySelector('[data-anim-tracks]')
  };

  ui.play.addEventListener('click', () => setAnimationPlaying(!animationState.playing));
  ui.stop.addEventListener('click', stopAnimationPlayback);
  ui.speed.addEventListener('input', () => {
    animationState.speed = THREE.MathUtils.clamp(parseFloat(ui.speed.value) || 1, 0.1, 4);
    updateAnimationUI(false);
  });
  ui.zoom.addEventListener('input', () => {
    animationState.zoom = THREE.MathUtils.clamp(parseFloat(ui.zoom.value) || 0, 0, 100);
    refreshAnimationPanel(false);
  });
  ui.addKey.addEventListener('click', addAnimationKeyForCurrentSelection);
  ui.autoKey.addEventListener('click', () => {
    animationState.autoKey = !animationState.autoKey;
    updateAnimationUI(false);
  });
  ui.timeline?.addEventListener('pointerdown', handleAnimationTimelinePointerDown);
  ui.frameNumber.addEventListener('input', () => applyAnimationFrame(parseFloat(ui.frameNumber.value) || 0));
  animationState.uiBuilt = true;
}

function renderAnimationTimeline() {
  if (!animationState.uiBuilt || !animationState.ui.ruler || !animationState.ui.tracks) return;
  const { start, end, visibleCount } = getAnimationVisibleRange();
  const ruler = animationState.ui.ruler;
  const tracks = animationState.ui.tracks;
  ruler.innerHTML = '';
  tracks.innerHTML = '';

  const tickStep = Math.max(1, Math.round(visibleCount / 10));
  for (let frame = start; frame <= end; frame += tickStep) {
    const tick = document.createElement('div');
    tick.className = 'animation-tick';
    tick.style.left = `${((frame - start) / Math.max(1, end - start)) * 100}%`;
    tick.innerHTML = `<span></span><em>${frame}</em>`;
    ruler.appendChild(tick);
  }

  const playhead = document.createElement('div');
  playhead.className = 'animation-playhead';
  playhead.dataset.animPlayhead = 'ruler';
  playhead.style.left = `${((animationState.currentFrame - start) / Math.max(1, end - start)) * 100}%`;
  ruler.appendChild(playhead);

  const records = [...animationState.tracks.values()].filter(record => record.keys.length);
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'animation-empty';
    empty.textContent = 'No animation keys yet. Select an object and click Add Key, or change a property while Auto Key is enabled.';
    tracks.appendChild(empty);
    tracks.appendChild(renderDopeSheet(records, start, end));
    return;
  }

  for (const record of records) {
    const row = document.createElement('div');
    row.className = 'animation-track-row';
    const label = document.createElement('div');
    label.className = 'animation-track-label';
    label.textContent = record.name;
    const lane = document.createElement('div');
    lane.className = 'animation-track-lane';
    const laneHead = document.createElement('div');
    laneHead.className = 'animation-lane-playhead';
    laneHead.dataset.animPlayhead = 'lane';
    laneHead.style.left = `${((animationState.currentFrame - start) / Math.max(1, end - start)) * 100}%`;
    lane.appendChild(laneHead);
    for (const key of record.keys) {
      if (key.frame < start || key.frame > end) continue;
      lane.appendChild(createAnimationKeyDot(record, key, start, end));
    }
    row.append(label, lane);
    tracks.appendChild(row);
  }

  tracks.appendChild(renderDopeSheet(records, start, end));
}

function updateAnimationPlayheadsOnly() {
  syncAnimationPlayheads(animationState, getAnimationVisibleRange());
}

function updateAnimationUI(renderTimeline = true) {
  if (!animationState.uiBuilt) return;
  const ui = animationState.ui;
  if (ui.play) ui.play.textContent = animationState.playing ? '⏸ Pause' : '▶ Play';
  if (ui.speed) ui.speed.value = String(Number(animationState.speed).toFixed(1));
  if (ui.zoom) ui.zoom.value = String(animationState.zoom);
  if (ui.autoKey) {
    ui.autoKey.classList.toggle('active', animationState.autoKey);
    ui.autoKey.textContent = animationState.autoKey ? '● Auto Key' : '○ Auto Key';
  }
  if (ui.frameNumber) {
    ui.frameNumber.max = String(animationState.totalFrames);
    ui.frameNumber.value = String(Math.round(animationState.currentFrame));
  }
  if (renderTimeline) renderAnimationTimeline();
  else updateAnimationPlayheadsOnly();
}

function refreshAnimationPanel(rebuild = true) {
  if (!animationContent) return;
  if (rebuild || !animationState.uiBuilt) buildAnimationPanel();
  updateAnimationUI(true);
}

function switchBottomTab(tabName) {
  document.querySelectorAll('[data-bottom-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.bottomTab === tabName));
  document.querySelectorAll('[data-bottom-content]').forEach(panel => panel.classList.toggle('active', panel.dataset.bottomContent === tabName));
  if (tabName === 'material') refreshMaterialAsset();
  if (tabName === 'properties') refreshToolProperties();
  if (tabName === 'animation') refreshAnimationPanel();
  if (tabName === 'history') renderHistoryPanel();
}

function refreshInspector(rebuild = true) {
  if (!rebuild && editMode === 'object' && selectedObjects.length !== 1) return;
  inspectorContent.innerHTML = '';

  if (editMode !== 'object') {
    const count = getComponentSelectionCount();
    const note = document.createElement('div');
    note.className = 'inspector-note';
    if (!count) {
      note.innerHTML = `<strong>${capitalize(editMode)} Mode</strong><br>Right-click in the viewport and use Mode to switch between Object, Face, Edge, and Vertex. Modeling tools are available from the right-click menu and the top Tools menu. Click to select one ${editMode}. Use Shift + click for multiple ${editMode} selection. Drag in the viewport for rectangle selection. Hold Alt + mouse to orbit.`;
    } else {
      note.innerHTML = `<strong>${count} ${editMode}${count === 1 ? '' : editMode === 'vertex' ? ' groups' : 's'} selected.</strong><br>Use the visible gizmo to move, rotate, or scale the selected ${editMode} selection directly on the mesh geometry. Face mode selects one triangulated Three.js face; Edge mode selects a triangle edge; moved component vertices remain welded to the object. Switch Move / Rotate / Scale from the top Tools menu.`;
    }
    inspectorContent.appendChild(note);
    return;
  }

  if (!selectedObjects.length) {
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    empty.textContent = 'Select an object from the viewport or Project Structure.';
    inspectorContent.appendChild(empty);
    return;
  }

  if (selectedObjects.length > 1) {
    const note = document.createElement('div');
    note.className = 'inspector-note';
    note.innerHTML = `<strong>${selectedObjects.length} objects selected.</strong><br>Use the visible gizmo in the viewport to move, rotate, or scale all selected objects together. Switch gizmo mode from the top Tools menu.`;
    inspectorContent.appendChild(note);
    return;
  }

  const object = selectedObjects[0];
  const grid = document.createElement('div');
  grid.className = 'form-grid';

  grid.appendChild(createInput('Name', object.name, value => {
    object.name = value.trim() || object.name;
    selectedBadge.textContent = `Mode: Object • Selected: ${object.name}`;
    refreshSceneTree();
  }, 'text'));

  grid.appendChild(createInput('Position X', toFixed(object.position.x), value => { object.position.x = parseFloat(value) || 0; }));
  grid.appendChild(createInput('Position Y', toFixed(object.position.y), value => { object.position.y = parseFloat(value) || 0; }));
  grid.appendChild(createInput('Position Z', toFixed(object.position.z), value => { object.position.z = parseFloat(value) || 0; }));

  grid.appendChild(createInput('Rotation X°', toFixed(deg(object.rotation.x)), value => { object.rotation.x = rad(parseFloat(value) || 0); }));
  grid.appendChild(createInput('Rotation Y°', toFixed(deg(object.rotation.y)), value => { object.rotation.y = rad(parseFloat(value) || 0); }));
  grid.appendChild(createInput('Rotation Z°', toFixed(deg(object.rotation.z)), value => { object.rotation.z = rad(parseFloat(value) || 0); }));

  grid.appendChild(createInput('Scale X', toFixed(object.scale.x), value => { object.scale.x = parseFloat(value) || 0.001; }));
  grid.appendChild(createInput('Scale Y', toFixed(object.scale.y), value => { object.scale.y = parseFloat(value) || 0.001; }));
  grid.appendChild(createInput('Scale Z', toFixed(object.scale.z), value => { object.scale.z = parseFloat(value) || 0.001; }));

  if (object.isMesh && object.material?.color) {
    grid.appendChild(createInput('Material Color', `#${object.material.color.getHexString()}`, value => {
      object.material.color.set(value);
    }, 'color'));
  }

  if (object.isLight) {
    grid.appendChild(createInput('Light Intensity', toFixed(object.intensity), value => {
      object.intensity = parseFloat(value) || 0;
    }));
    if (object.color) {
      grid.appendChild(createInput('Light Color', `#${object.color.getHexString()}`, value => {
        object.color.set(value);
      }, 'color'));
    }
  }

  if (isSceneCameraObject(object)) {
    const actions = document.createElement('div');
    actions.className = 'camera-inspector-actions';
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.textContent = 'View Through Camera';
    viewBtn.addEventListener('click', () => viewThroughCameraObject(object));
    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.textContent = 'Exit Camera View';
    exitBtn.addEventListener('click', () => exitCameraView());
    actions.append(viewBtn, exitBtn);
    inspectorContent.appendChild(actions);

    grid.appendChild(createInput('Camera Near', toFixed(object.near ?? 0.1), value => {
      object.near = Math.max(0.001, parseFloat(value) || 0.1);
      object.updateProjectionMatrix?.();
    }));
    grid.appendChild(createInput('Camera Far', toFixed(object.far ?? 1000), value => {
      object.far = Math.max(object.near + 0.001, parseFloat(value) || 1000);
      object.updateProjectionMatrix?.();
    }));
    grid.appendChild(createInput('Camera Zoom', toFixed(object.zoom ?? 1), value => {
      object.zoom = Math.max(0.01, parseFloat(value) || 1);
      object.updateProjectionMatrix?.();
    }));
    if (object.isPerspectiveCamera) {
      grid.appendChild(createInput('FOV', toFixed(object.fov ?? 50), value => {
        object.fov = THREE.MathUtils.clamp(parseFloat(value) || 50, 1, 175);
        object.updateProjectionMatrix?.();
      }));
    }
    if (object.isOrthographicCamera) {
      grid.appendChild(createInput('Ortho Size', toFixed(object.userData.orthoSize ?? 6), value => {
        object.userData.orthoSize = Math.max(0.1, parseFloat(value) || 6);
        updateOrthographicCameraBounds(object);
      }));
    }
  }

  inspectorContent.appendChild(grid);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function addByType(type) {
  hideContextMenu();
  closeTopToolsMenu();
  closeToolDropdowns();
  const isObjectType = OBJECT_TYPES.has(type);
  const isLightType = LIGHT_TYPES.has(type);
  const isCameraType = CAMERA_TYPES.has(type);
  if (!isObjectType && !isLightType && !isCameraType) return;
  const factory = () => isObjectType ? buildMeshItem(type) : isLightType ? buildLightItem(type) : buildCameraItem(type);
  const label = `Add ${ADD_LABELS[type] || type}`;
  commandManager.execute(new AddObjectCommand(label, factory));
}

function setTransformMode(mode) {
  currentTransformMode = mode;
  activePropertiesTool = mode;
  selectTool = 'transform';
  transform.setMode(mode);
  selectToolBtn?.classList.remove('active');
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  refreshToolProperties();
  updateSelectionState();
}

function setSelectTool(tool) {
  selectTool = tool;
  activePropertiesTool = tool;
  selectToolBtn?.classList.toggle('active', selectTool === 'select');
  if (selectTool === 'select') {
    transform.detach();
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.remove('active'));
  }
  refreshToolProperties();
  updateSelectionState();
}

function setEditMode(mode, options = {}) {
  if (!['object', 'face', 'edge', 'vertex'].includes(mode)) return;
  const changed = editMode !== mode;
  editMode = mode;
  if (changed && !options.keepSelection) {
    selectedObjects.length = 0;
    selectedFaces.length = 0;
    selectedEdges.length = 0;
    selectedVertices.length = 0;
  }
  document.querySelectorAll('[data-edit-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.editMode === editMode);
  });
  viewportHelp.textContent = `Mode: ${capitalize(editMode)} • View: ${viewModeManager.getLabel(activeViewMode)} • Hover highlights ${editMode === 'object' ? 'objects' : `${editMode}s`} • Select tool hides gizmo • Alt + mouse: orbit • Click/Shift-click: select • Drag: rectangle select • Move/Rotate/Scale: transform`;
  updateViewModeButtons();
  clearHoverItems();
  updateSelectionState();
}

function deleteSelected() {
  if (editMode !== 'object') {
    if (!deleteComponentsSelection()) clearAllSelections();
    return;
  }
  if (!selectedObjects.length) return;
  commandManager.execute(new DeleteObjectsCommand([...selectedObjects]));
}

function setPointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function findEditableMeshHit(event) {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, getViewportCamera());
  const hits = raycaster.intersectObjects(selectableObjects, true);
  for (const hit of hits) {
    const root = getRootEditorObject(hit.object);
    if (root && isObjectLocked(root)) continue;
    if (root?.isMesh && hit.faceIndex != null) return { hit, object: root };
  }
  return null;
}

function performClickSelection(event, additive = false) {
  if (transform.dragging || ignoreNextCanvasClick) return;

  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, getViewportCamera());
  const hits = raycaster.intersectObjects(selectableObjects, true);

  if (editMode === 'object') {
    let picked = hits.length ? getRootEditorObject(hits[0].object) : null;
    if (picked && isObjectLocked(picked)) picked = null;
    if (!picked) {
      if (!additive) clearAllSelections();
      return;
    }
    if (additive) toggleSelection(picked);
    else selectObjects([picked]);
    return;
  }

  const meshHit = findEditableMeshHit(event);
  if (!meshHit) {
    if (!additive) clearAllSelections();
    return;
  }

  if (editMode === 'face') {
    const item = makeFaceSelectionItem(meshHit.object, meshHit.hit.faceIndex);
    if (additive) toggleFaceItem(item);
    else selectFaceItems([item]);
  } else if (editMode === 'edge') {
    const item = makeEdgeSelectionItem(meshHit.object, meshHit.hit);
    if (additive) toggleEdgeItem(item);
    else selectEdgeItems([item]);
  } else if (editMode === 'vertex') {
    const item = makeVertexSelectionItem(meshHit.object, meshHit.hit);
    if (additive) toggleVertexItem(item);
    else selectVertexItems([item]);
  }
}

function getViewportRect() {
  return renderer.domElement.getBoundingClientRect();
}

function worldToViewportPixel(world, rect = getViewportRect()) {
  const projected = world.clone().project(camera);
  return new THREE.Vector2(
    rect.left + ((projected.x + 1) / 2) * rect.width,
    rect.top + ((-projected.y + 1) / 2) * rect.height
  );
}

function normalizeClientRect(aX, aY, bX, bY) {
  return {
    left: Math.min(aX, bX),
    top: Math.min(aY, bY),
    right: Math.max(aX, bX),
    bottom: Math.max(aY, bY)
  };
}

function pointInClientRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function screenRectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function objectIntersectsSelectionRect(object, rect) {
  object.updateMatrixWorld(true);
  if (object.isLight) {
    const p = worldToViewportPixel(object.getWorldPosition(new THREE.Vector3()));
    return pointInClientRect(p, rect);
  }

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    const p = worldToViewportPixel(object.getWorldPosition(new THREE.Vector3()));
    return pointInClientRect(p, rect);
  }

  const points = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z)
  ].map(p => worldToViewportPixel(p));

  const objectRect = points.reduce((acc, p) => ({
    left: Math.min(acc.left, p.x),
    top: Math.min(acc.top, p.y),
    right: Math.max(acc.right, p.x),
    bottom: Math.max(acc.bottom, p.y)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

  return screenRectsOverlap(rect, objectRect);
}

function triangleIntersectsSelectionRect(object, faceIndex, rect) {
  const ids = getTriangleVertexIndices(object.geometry, faceIndex);
  if (!ids.length) return false;
  object.updateMatrixWorld(true);
  const pts = ids.map(id => worldToViewportPixel(readLocalVertex(object.geometry, id, new THREE.Vector3()).applyMatrix4(object.matrixWorld)));
  if (pts.some(p => pointInClientRect(p, rect))) return true;
  const centroid = pts.reduce((acc, p) => acc.add(p), new THREE.Vector2()).multiplyScalar(1 / 3);
  if (pointInClientRect(centroid, rect)) return true;
  const triRect = pts.reduce((acc, p) => ({
    left: Math.min(acc.left, p.x),
    top: Math.min(acc.top, p.y),
    right: Math.max(acc.right, p.x),
    bottom: Math.max(acc.bottom, p.y)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  return screenRectsOverlap(rect, triRect);
}


function edgeIntersectsSelectionRect(object, edge, rect) {
  object.updateMatrixWorld(true);
  const a = worldToViewportPixel(readLocalVertex(object.geometry, edge.aIndex, new THREE.Vector3()).applyMatrix4(object.matrixWorld));
  const b = worldToViewportPixel(readLocalVertex(object.geometry, edge.bIndex, new THREE.Vector3()).applyMatrix4(object.matrixWorld));
  if (pointInClientRect(a, rect) || pointInClientRect(b, rect)) return true;
  const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
  if (pointInClientRect(mid, rect)) return true;
  const edgeRect = {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y)
  };
  return screenRectsOverlap(rect, edgeRect);
}

function collectEdgeItemsInRect(rect) {
  const items = new Map();
  for (const object of editorObjects.values()) {
    if (!object.isMesh || !object.geometry?.attributes?.position || isObjectLocked(object)) continue;
    const triCount = getTriangleCount(object.geometry);
    for (let faceIndex = 0; faceIndex < triCount; faceIndex++) {
      const ids = getTriangleVertexIndices(object.geometry, faceIndex);
      if (ids.length !== 3) continue;
      const faceEdges = [
        { aIndex: ids[0], bIndex: ids[1] },
        { aIndex: ids[1], bIndex: ids[2] },
        { aIndex: ids[2], bIndex: ids[0] }
      ];
      for (const edge of faceEdges) {
        if (!edgeIntersectsSelectionRect(object, edge, rect)) continue;
        const item = makeEdgeSelectionItem(object, edge);
        if (item) items.set(item.key, item);
      }
    }
  }
  return [...items.values()];
}

function collectFaceItemsInRect(rect) {
  const items = new Map();
  for (const object of editorObjects.values()) {
    if (!object.isMesh || !object.geometry?.attributes?.position || isObjectLocked(object)) continue;
    const triCount = getTriangleCount(object.geometry);
    for (let i = 0; i < triCount; i++) {
      if (!triangleIntersectsSelectionRect(object, i, rect)) continue;
      const item = makeFaceSelectionItem(object, i);
      if (item) items.set(item.key, item);
    }
  }
  return [...items.values()];
}

function collectVertexItemsInRect(rect) {
  const items = new Map();
  for (const object of editorObjects.values()) {
    if (!object.isMesh || !object.geometry?.attributes?.position || isObjectLocked(object)) continue;
    object.updateMatrixWorld(true);
    const pos = object.geometry.attributes.position;
    const localGroups = new Map();
    for (let i = 0; i < pos.count; i++) {
      const local = readLocalVertex(object.geometry, i, new THREE.Vector3());
      const keyPart = roundedVertexKey(local);
      if (!localGroups.has(keyPart)) localGroups.set(keyPart, []);
      localGroups.get(keyPart).push(i);
    }
    for (const [keyPart, indices] of localGroups) {
      const center = new THREE.Vector3();
      for (const index of indices) center.add(readLocalVertex(object.geometry, index, new THREE.Vector3()));
      center.multiplyScalar(1 / Math.max(indices.length, 1)).applyMatrix4(object.matrixWorld);
      const screenPoint = worldToViewportPixel(center);
      if (pointInClientRect(screenPoint, rect)) {
        const item = { object, indices, key: `${object.userData.editorId}:vertex:${keyPart}` };
        items.set(item.key, item);
      }
    }
  }
  return [...items.values()];
}

function performRectangleSelection(clientRect, additive = false) {
  if (editMode === 'object') {
    const picked = Array.from(editorObjects.values()).filter(object => isObjectSelectable(object) && objectIntersectsSelectionRect(object, clientRect));
    if (additive) {
      const merged = [...selectedObjects];
      for (const object of picked) if (!merged.includes(object)) merged.push(object);
      selectObjects(merged);
    } else {
      selectObjects(picked);
    }
  } else if (editMode === 'face') {
    const items = collectFaceItemsInRect(clientRect);
    selectFaceItems(items, additive);
  } else if (editMode === 'edge') {
    const items = collectEdgeItemsInRect(clientRect);
    selectEdgeItems(items, additive);
  } else if (editMode === 'vertex') {
    const items = collectVertexItemsInRect(clientRect);
    selectVertexItems(items, additive);
  }
}

function updateSelectionRectVisual(startX, startY, currentX, currentY) {
  const viewportRect = viewport.getBoundingClientRect();
  const left = Math.min(startX, currentX) - viewportRect.left;
  const top = Math.min(startY, currentY) - viewportRect.top;
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  selectionRect.style.left = `${left}px`;
  selectionRect.style.top = `${top}px`;
  selectionRect.style.width = `${width}px`;
  selectionRect.style.height = `${height}px`;
}

function startBoxPointerFlow(event) {
  if (event.button !== 0 || transform.dragging || transform.axis) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  hideContextMenu();

  const additive = isAdditiveSelectionEvent(event);
  boxDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    dragging: false,
    additive
  };
  renderer.domElement.setPointerCapture?.(event.pointerId);
  orbit.enabled = false;

  const move = moveEvent => {
    if (!boxDragState || moveEvent.pointerId !== boxDragState.pointerId) return;
    boxDragState.currentX = moveEvent.clientX;
    boxDragState.currentY = moveEvent.clientY;
    const dx = boxDragState.currentX - boxDragState.startX;
    const dy = boxDragState.currentY - boxDragState.startY;
    if (!boxDragState.dragging && Math.hypot(dx, dy) > 4) {
      boxDragState.dragging = true;
      selectionRect.classList.add('visible');
    }
    if (boxDragState.dragging) updateSelectionRectVisual(boxDragState.startX, boxDragState.startY, boxDragState.currentX, boxDragState.currentY);
  };

  const up = upEvent => {
    if (!boxDragState || upEvent.pointerId !== boxDragState.pointerId) return;
    renderer.domElement.releasePointerCapture?.(upEvent.pointerId);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    selectionRect.classList.remove('visible');
    setOrbitTemporaryEnabled(false);

    if (boxDragState.dragging) {
      const rect = normalizeClientRect(boxDragState.startX, boxDragState.startY, upEvent.clientX, upEvent.clientY);
      performRectangleSelection(rect, boxDragState.additive);
    } else {
      performClickSelection(upEvent, boxDragState.additive);
    }

    boxDragState = null;
  };

  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
}


function updateComponentHoverFromEvent(event) {
  if (boxDragState || transform.dragging || editMode === 'object') {
    clearHoverItems();
    return;
  }
  const meshHit = findEditableMeshHit(event);
  hoveredFace = null;
  hoveredEdge = null;
  hoveredVertex = null;
  if (meshHit) {
    if (editMode === 'face') hoveredFace = makeFaceSelectionItem(meshHit.object, meshHit.hit.faceIndex);
    else if (editMode === 'edge') hoveredEdge = makeEdgeSelectionItem(meshHit.object, meshHit.hit);
    else if (editMode === 'vertex') hoveredVertex = makeVertexSelectionItem(meshHit.object, meshHit.hit);
  }
  refreshHoverOverlays();
}

renderer.domElement.addEventListener('pointermove', event => {
  updateComponentHoverFromEvent(event);
});
renderer.domElement.addEventListener('pointerleave', () => {
  clearHoverItems();
});

renderer.domElement.addEventListener('pointerdown', event => {
  // Alt + left mouse rotates. Middle mouse pans. Mouse wheel zooms through OrbitControls.
  if ((event.button === 0 && isOrbitEvent(event)) || isPanEvent(event)) {
    setOrbitTemporaryEnabled(true);
    return;
  }

  if (handleMeasurementPointerDown(event)) return;

  if (event.button !== 0) return;
  startBoxPointerFlow(event);
}, true);

renderer.domElement.addEventListener('wheel', () => {
  enableOrbitForWheelOnce();
}, { capture: true, passive: true });

window.addEventListener('pointerup', () => {
  setOrbitTemporaryEnabled(false);
});
window.addEventListener('pointercancel', () => {
  setOrbitTemporaryEnabled(false);
});

renderer.domElement.addEventListener('click', event => {
  // Click selection is handled by startBoxPointerFlow when the pointer did not drag.
  // Alt-click belongs to OrbitControls and should not select.
  if (isOrbitEvent(event)) return;
});

renderer.domElement.addEventListener('contextmenu', event => {
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY);
});

function showContextMenu(clientX, clientY) {
  editorContextMenu.classList.add('open');
  editorContextMenu.setAttribute('aria-hidden', 'false');
  const menuRect = editorContextMenu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - menuRect.width - 8);
  const y = Math.min(clientY, window.innerHeight - menuRect.height - 8);
  editorContextMenu.style.left = `${Math.max(8, x)}px`;
  editorContextMenu.style.top = `${Math.max(8, y)}px`;
}

function hideContextMenu() {
  editorContextMenu.classList.remove('open');
  editorContextMenu.setAttribute('aria-hidden', 'true');
}

function resetView() {
  camera.position.set(6, 5, 7);
  orbit.target.set(0, 0, 0);
  orbit.update();
}

function resizeRenderer() {
  const width = Math.max(viewport.clientWidth, 1);
  const height = Math.max(viewport.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  for (const object of editorObjects.values()) {
    if (object.isPerspectiveCamera) { object.aspect = width / height; object.updateProjectionMatrix?.(); }
    if (object.isOrthographicCamera) updateOrthographicCameraBounds(object, width / height);
  }
  renderer.setSize(width, height, false);
}

function makeHorizontalResize(splitter, panel, side) {
  if (!splitter || !panel) return;
  splitter.addEventListener('pointerdown', event => {
    event.preventDefault();
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    splitter.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;

    const move = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const next = side === 'left' ? startWidth + dx : startWidth - dx;
      panel.style.width = `${Math.max(84, Math.min(560, next))}px`;
      resizeRenderer();
    };
    const up = upEvent => {
      splitter.releasePointerCapture(upEvent.pointerId);
      splitter.classList.remove('dragging');
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      resizeRenderer();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function makeVerticalResize(splitter, panel) {
  if (!splitter || !panel) return;
  splitter.addEventListener('pointerdown', event => {
    event.preventDefault();
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    splitter.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = panel.getBoundingClientRect().height;

    const move = moveEvent => {
      const dy = moveEvent.clientY - startY;
      const next = startHeight - dy;
      panel.style.height = `${Math.max(110, Math.min(window.innerHeight * 0.6, next))}px`;
      resizeRenderer();
    };
    const up = upEvent => {
      splitter.releasePointerCapture(upEvent.pointerId);
      splitter.classList.remove('dragging');
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      resizeRenderer();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function closeToolDropdowns(except = null) {
  for (const dropdown of document.querySelectorAll('.tool-dropdown')) {
    if (dropdown !== except) dropdown.classList.remove('open');
  }
}

function positionToolFlyout(button, optionsPanel) {
  const rect = button.getBoundingClientRect();
  const margin = 10;
  const panelWidth = Math.max(optionsPanel.offsetWidth || 184, 184);
  let left = rect.right + margin;
  let top = rect.top;

  if (left + panelWidth + margin > window.innerWidth) {
    left = Math.max(margin, rect.left - panelWidth - margin);
  }

  optionsPanel.style.left = `${left}px`;
  optionsPanel.style.top = `${top}px`;

  requestAnimationFrame(() => {
    const flyoutRect = optionsPanel.getBoundingClientRect();
    let nextTop = top;
    if (flyoutRect.bottom + margin > window.innerHeight) {
      nextTop = Math.max(margin, window.innerHeight - flyoutRect.height - margin);
    }
    optionsPanel.style.top = `${nextTop}px`;
  });
}

function openToolFlyout(button, optionsPanel) {
  if (!button || !optionsPanel) return;
  const dropdown = button.closest('.tool-dropdown');
  const willOpen = !dropdown.classList.contains('open');
  closeToolDropdowns(dropdown);
  dropdown.classList.toggle('open', willOpen);
  if (willOpen) positionToolFlyout(button, optionsPanel);
}


function textureWrappingToName(value) {
  if (value === THREE.ClampToEdgeWrapping) return 'ClampToEdgeWrapping';
  if (value === THREE.MirroredRepeatWrapping) return 'MirroredRepeatWrapping';
  return 'RepeatWrapping';
}

function textureWrappingFromName(value) {
  if (value === 'ClampToEdgeWrapping') return THREE.ClampToEdgeWrapping;
  if (value === 'MirroredRepeatWrapping') return THREE.MirroredRepeatWrapping;
  return THREE.RepeatWrapping;
}

function colorHexFromMaybeColor(value, fallback = 0xffffff) {
  return value?.getHex?.() ?? fallback;
}

function serializeTexture(texture) {
  if (!texture) return null;
  return {
    src: texture.image?.src || null,
    repeat: { x: texture.repeat?.x ?? 1, y: texture.repeat?.y ?? 1 },
    offset: { x: texture.offset?.x ?? 0, y: texture.offset?.y ?? 0 },
    rotation: texture.rotation ?? 0,
    center: { x: texture.center?.x ?? 0, y: texture.center?.y ?? 0 },
    wrapS: textureWrappingToName(texture.wrapS),
    wrapT: textureWrappingToName(texture.wrapT),
    flipY: texture.flipY !== false
  };
}

function applySerializedTexture(material, data) {
  if (!material || !data?.src || !materialSupportsTexture(material)) return;
  const image = new Image();
  image.onload = () => {
    const texture = new THREE.Texture(image);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(data.repeat?.x ?? 1, data.repeat?.y ?? 1);
    texture.offset.set(data.offset?.x ?? 0, data.offset?.y ?? 0);
    texture.center.set(data.center?.x ?? 0, data.center?.y ?? 0);
    texture.rotation = Number(data.rotation) || 0;
    texture.wrapS = textureWrappingFromName(data.wrapS);
    texture.wrapT = textureWrappingFromName(data.wrapT);
    texture.flipY = data.flipY !== false;
    texture.needsUpdate = true;
    material.map?.dispose?.();
    material.map = texture;
    material.needsUpdate = true;
    refreshMaterialAsset();
    refreshInspector(false);
  };
  image.src = data.src;
}

function serializeMaterial(material) {
  if (!material) return null;
  const data = {
    type: material.type,
    name: material.name || material.type,
    side: material.side,
    transparent: Boolean(material.transparent),
    opacity: 'opacity' in material ? material.opacity : 1,
    wireframe: Boolean(material.wireframe),
    flatShading: Boolean(material.flatShading)
  };
  if (material.color) data.color = material.color.getHex();
  if (material.emissive) data.emissive = material.emissive.getHex();
  if (material.specular) data.specular = material.specular.getHex();
  for (const key of ['roughness','metalness','clearcoat','clearcoatRoughness','reflectivity','transmission','thickness','ior','shininess','alphaTest']) {
    if (key in material && typeof material[key] === 'number') data[key] = material[key];
  }
  data.map = serializeTexture(material.map);
  return data;
}

function createMaterialFromSerialized(data) {
  if (!data) return createMaterial();
  let material = createMaterialByType(data.type || 'MeshStandardMaterial', {
    color: data.color ?? 0x7db5ff,
    opacity: data.opacity ?? 1,
    transparent: data.transparent ?? false,
    side: data.side ?? THREE.FrontSide,
    name: data.name || data.type || 'Imported Material'
  });
  if (data.name) material.name = data.name;
  if (material.color && data.color != null) material.color.setHex(Number(data.color));
  if (material.emissive && data.emissive != null) material.emissive.setHex(Number(data.emissive));
  if (material.specular && data.specular != null) material.specular.setHex(Number(data.specular));
  for (const key of ['roughness','metalness','clearcoat','clearcoatRoughness','reflectivity','transmission','thickness','ior','shininess','alphaTest','opacity']) {
    if (key in material && data[key] != null) material[key] = Number(data[key]);
  }
  if ('transparent' in material) material.transparent = Boolean(data.transparent);
  if ('wireframe' in material) material.wireframe = Boolean(data.wireframe);
  if ('flatShading' in material) material.flatShading = Boolean(data.flatShading);
  if ('side' in material && data.side != null) material.side = Number(data.side);
  applySerializedTexture(material, data.map);
  material.needsUpdate = true;
  return material;
}

function serializeGeometry(geometry) {
  if (!geometry) return null;
  const out = { attributes: {}, index: null, groups: [] };
  for (const name of ['position','normal','uv','color']) {
    const attr = geometry.attributes?.[name];
    if (attr?.array) {
      out.attributes[name] = {
        itemSize: attr.itemSize,
        array: Array.from(attr.array)
      };
    }
  }
  if (geometry.index?.array) out.index = Array.from(geometry.index.array);
  if (geometry.groups?.length) {
    out.groups = geometry.groups.map(group => ({ start: group.start, count: group.count, materialIndex: group.materialIndex || 0 }));
  }
  return out;
}

function createGeometryFromSerialized(data) {
  const geometry = new THREE.BufferGeometry();
  if (!data?.attributes?.position?.array) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    return geometry;
  }
  for (const [name, attr] of Object.entries(data.attributes || {})) {
    const itemSize = Number(attr.itemSize) || (name === 'uv' ? 2 : 3);
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(attr.array || [], itemSize));
  }
  if (data.index?.length) geometry.setIndex(data.index);
  geometry.clearGroups();
  for (const group of data.groups || []) geometry.addGroup(group.start || 0, group.count || 0, group.materialIndex || 0);
  if (!geometry.attributes.normal) geometry.computeVertexNormals?.();
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  return geometry;
}

function serializeObject(object) {
  const data = {
    id: object.userData?.editorId,
    name: object.name,
    editorType: object.userData?.editorType || object.type,
    threeType: object.type,
    visible: object.visible !== false,
    locked: !!object.userData?.locked,
    transform: {
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray()
    },
    parentId: object.parent?.userData?.editorId || null
  };

  if (object.isMesh) {
    data.kind = 'mesh';
    data.geometry = serializeGeometry(object.geometry);
    const realMaterial = viewModeManager.getRealMaterial(object);
    data.materials = Array.isArray(realMaterial) ? realMaterial.map(serializeMaterial) : [serializeMaterial(realMaterial)];
    data.materialIsArray = Array.isArray(realMaterial);
    data.castShadow = Boolean(object.castShadow);
    data.receiveShadow = Boolean(object.receiveShadow);
  } else if (isSceneCameraObject(object)) {
    data.kind = 'camera';
    data.camera = {
      type: object.isOrthographicCamera ? 'OrthographicCamera' : 'PerspectiveCamera',
      fov: object.fov ?? 50,
      aspect: object.aspect ?? 1,
      near: object.near ?? 0.1,
      far: object.far ?? 1000,
      zoom: object.zoom ?? 1,
      orthoSize: object.userData?.orthoSize ?? 6
    };
  } else if (object.isLight) {
    data.kind = 'light';
    data.light = {
      color: colorHexFromMaybeColor(object.color, 0xffffff),
      intensity: object.intensity ?? 1,
      distance: object.distance ?? 0,
      decay: object.decay ?? 1,
      angle: object.angle ?? Math.PI / 6,
      penumbra: object.penumbra ?? 0,
      width: object.width ?? 1,
      height: object.height ?? 1,
      groundColor: object.groundColor?.getHex?.() ?? 0x334466
    };
  } else {
    data.kind = 'object3d';
  }
  return data;
}

function createLightFromSerialized(data) {
  const type = data.threeType || '';
  const lightData = data.light || {};
  let light;
  if (type === 'DirectionalLight') light = new THREE.DirectionalLight(lightData.color ?? 0xffffff, lightData.intensity ?? 1);
  else if (type === 'HemisphereLight') light = new THREE.HemisphereLight(lightData.color ?? 0xffffff, lightData.groundColor ?? 0x334466, lightData.intensity ?? 1);
  else if (type === 'PointLight') light = new THREE.PointLight(lightData.color ?? 0xffffff, lightData.intensity ?? 1, lightData.distance ?? 0, lightData.decay ?? 1);
  else if (type === 'SpotLight') light = new THREE.SpotLight(lightData.color ?? 0xffffff, lightData.intensity ?? 1, lightData.distance ?? 0, lightData.angle ?? Math.PI / 6, lightData.penumbra ?? 0, lightData.decay ?? 1);
  else if (type === 'RectAreaLight') light = new THREE.RectAreaLight(lightData.color ?? 0xffffff, lightData.intensity ?? 1, lightData.width ?? 1, lightData.height ?? 1);
  else light = new THREE.AmbientLight(lightData.color ?? 0xffffff, lightData.intensity ?? 1);
  if ('distance' in light && lightData.distance != null) light.distance = Number(lightData.distance);
  if ('decay' in light && lightData.decay != null) light.decay = Number(lightData.decay);
  if ('angle' in light && lightData.angle != null) light.angle = Number(lightData.angle);
  if ('penumbra' in light && lightData.penumbra != null) light.penumbra = Number(lightData.penumbra);
  if ('width' in light && lightData.width != null) light.width = Number(lightData.width);
  if ('height' in light && lightData.height != null) light.height = Number(lightData.height);
  if (light.groundColor && lightData.groundColor != null) light.groundColor.setHex(Number(lightData.groundColor));
  const helper = makeLightHelperMesh(light.userData?.editorType || type, lightData.color ?? 0xffdd77);
  helper.name = `${data.name || type} Helper`;
  helper.userData.internal = true;
  light.add(helper);
  return light;
}


function createCameraFromSerialized(data) {
  const camData = data.camera || {};
  const aspect = Math.max(viewport.clientWidth, 1) / Math.max(viewport.clientHeight, 1);
  let cam;
  if (camData.type === 'OrthographicCamera') {
    const size = Number(camData.orthoSize) || 6;
    cam = new THREE.OrthographicCamera(-size * aspect / 2, size * aspect / 2, size / 2, -size / 2, camData.near ?? 0.1, camData.far ?? 1000);
    cam.userData.orthoSize = size;
  } else {
    cam = new THREE.PerspectiveCamera(camData.fov ?? 50, aspect, camData.near ?? 0.1, camData.far ?? 1000);
  }
  if (camData.zoom != null) cam.zoom = Number(camData.zoom);
  cam.updateProjectionMatrix?.();
  cam.add(makeCameraPreviewHelper(cam.isOrthographicCamera ? 'orthographicCamera' : 'perspectiveCamera'));
  return cam;
}

function createObjectFromSerialized(data) {
  let object;
  if (data.kind === 'mesh') {
    const geometry = createGeometryFromSerialized(data.geometry);
    const materials = (data.materials || []).map(createMaterialFromSerialized).filter(Boolean);
    object = new THREE.Mesh(geometry, data.materialIsArray ? materials : (materials[0] || createMaterial()));
    object.castShadow = Boolean(data.castShadow);
    object.receiveShadow = Boolean(data.receiveShadow);
  } else if (data.kind === 'camera') {
    object = createCameraFromSerialized(data);
  } else if (data.kind === 'light') {
    object = createLightFromSerialized(data);
  } else {
    object = new THREE.Object3D();
  }
  object.name = data.name || data.editorType || data.threeType || 'Imported Object';
  if (data.transform?.position) object.position.fromArray(data.transform.position);
  if (data.transform?.rotation) object.rotation.set(data.transform.rotation[0] || 0, data.transform.rotation[1] || 0, data.transform.rotation[2] || 0);
  if (data.transform?.scale) object.scale.fromArray(data.transform.scale);
  object.visible = data.visible !== false;
  object.userData.locked = !!data.locked;
  object.userData.editorId = data.id || makeEditorId();
  object.userData.editorType = data.editorType || data.threeType || object.type;
  return object;
}

function serializeAnimationTracks() {
  return [...animationState.tracks.values()].map(record => ({
    objectId: record.objectId,
    name: record.name,
    keys: record.keys.map(key => ({ frame: key.frame, state: clonePlain(key.state) }))
  }));
}

function serializeProject() {
  const selectedIds = selectedObjects.map(object => object.userData?.editorId).filter(Boolean);
  return {
    version: 1,
    meta: {
      app: '3D Model Editor',
      savedAt: new Date().toISOString()
    },
    scene: {
      objects: [...editorObjects.values()].filter(object => object.parent).map(serializeObject),
      camera: {
        position: camera.position.toArray(),
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        zoom: camera.zoom,
        orbitTarget: orbit.target.toArray()
      }
    },
    editor: {
      editMode,
      selectTool,
      currentTransformMode,
      activePropertiesTool,
      activeViewMode,
      modelingToolSettings: clonePlain(modelingToolSettings),
      selectedObjectIds: selectedIds,
      activeCameraViewObjectId: activeCameraViewObject?.userData?.editorId || null
    },
    animation: {
      currentFrame: animationState.currentFrame,
      totalFrames: animationState.totalFrames,
      fps: animationState.fps,
      speed: animationState.speed,
      zoom: animationState.zoom,
      autoKey: animationState.autoKey,
      tracks: serializeAnimationTracks()
    }
  };
}

function clearProjectScene() {
  setAnimationPlaying(false);
  clearAllSelections();
  transform.detach();
  for (const object of [...editorObjects.values()]) removeObjectFromEditor(object, { dispose: true });
  editorObjects.clear();
  selectableObjects.length = 0;
  animationState.tracks.clear();
  animationState.baselines.clear();
  activeExtrudeSession = null;
  if (activeCameraViewObject) setCameraObjectHelpersVisible(activeCameraViewObject, true);
  activeCameraViewObject = null;
  updateCameraFrameOverlay();
}

function applyProjectData(project) {
  if (!project?.scene?.objects) throw new Error('Project file does not contain a scene object list.');
  clearProjectScene();

  let maxNumericId = 0;
  const imported = new Map();
  for (const data of project.scene.objects) {
    const object = createObjectFromSerialized(data);
    markEditorObject(object, data.editorType || data.threeType || object.type);
    scene.add(object);
    imported.set(data.id, object);
    const match = String(data.id || '').match(/(\d+)$/);
    if (match) maxNumericId = Math.max(maxNumericId, Number(match[1]));
    object.traverse(child => {
      if (child !== object && child.userData?.internal) {
        child.userData.helperFor = object.userData.editorId;
        if (!selectableObjects.includes(child)) selectableObjects.push(child);
      }
    });
  }

  // Restore simple hierarchy where both parent and child are editor objects.
  for (const data of project.scene.objects) {
    if (!data.parentId) continue;
    const child = imported.get(data.id);
    const parent = imported.get(data.parentId);
    if (child && parent && child.parent !== parent) parent.add(child);
  }

  idCounter = Math.max(idCounter, maxNumericId + 1);

  const savedCamera = project.scene.camera;
  if (savedCamera) {
    if (savedCamera.position) camera.position.fromArray(savedCamera.position);
    if (savedCamera.rotation) camera.rotation.set(savedCamera.rotation[0] || 0, savedCamera.rotation[1] || 0, savedCamera.rotation[2] || 0);
    if (savedCamera.fov != null) camera.fov = Number(savedCamera.fov);
    if (savedCamera.near != null) camera.near = Number(savedCamera.near);
    if (savedCamera.far != null) camera.far = Number(savedCamera.far);
    if (savedCamera.zoom != null) camera.zoom = Number(savedCamera.zoom);
    if (savedCamera.orbitTarget) orbit.target.fromArray(savedCamera.orbitTarget);
    camera.updateProjectionMatrix?.();
    orbit.update?.();
  }

  const savedEditor = project.editor || {};
  if (savedEditor.modelingToolSettings) {
    Object.assign(modelingToolSettings, structuredClone(DEFAULT_MODELING_TOOL_SETTINGS), savedEditor.modelingToolSettings);
  }
  editMode = savedEditor.editMode || 'object';
  selectTool = savedEditor.selectTool || 'select';
  currentTransformMode = savedEditor.currentTransformMode || 'translate';
  activePropertiesTool = savedEditor.activePropertiesTool || selectTool || 'select';
  activeViewMode = savedEditor.activeViewMode || 'material';

  const savedAnimation = project.animation || {};
  animationState.currentFrame = Number(savedAnimation.currentFrame) || 0;
  animationState.totalFrames = Number(savedAnimation.totalFrames) || animationState.totalFrames;
  animationState.fps = Number(savedAnimation.fps) || animationState.fps;
  animationState.speed = Number(savedAnimation.speed) || animationState.speed;
  animationState.zoom = Number(savedAnimation.zoom) || animationState.zoom;
  animationState.autoKey = savedAnimation.autoKey !== false;
  for (const record of savedAnimation.tracks || []) {
    const object = imported.get(record.objectId) || editorObjects.get(record.objectId);
    animationState.tracks.set(record.objectId, {
      objectId: record.objectId,
      object,
      name: record.name || object?.name || 'Animated Object',
      keys: (record.keys || []).map(key => ({ frame: Math.round(Number(key.frame) || 0), state: clonePlain(key.state) })).sort((a, b) => a.frame - b.frame)
    });
  }

  setEditMode(editMode, { keepSelection: true });
  if (savedEditor.selectedObjectIds?.length) {
    const objects = savedEditor.selectedObjectIds.map(id => editorObjects.get(id)).filter(Boolean);
    if (objects.length) selectObjects(objects);
  }
  if (savedEditor.activeCameraViewObjectId) {
    const camObj = editorObjects.get(savedEditor.activeCameraViewObjectId);
    if (isSceneCameraObject(camObj)) {
      activeCameraViewObject = camObj;
      setCameraObjectHelpersVisible(activeCameraViewObject, false);
    }
  } else {
    activeCameraViewObject = null;
  }
  updateCameraFrameOverlay();
  setViewMode(activeViewMode);
  syncGridMeasurementSettings();
  transform.camera = getViewportCamera();
  setTransformMode(currentTransformMode);
  if (selectTool === 'select') setSelectTool('select');
  refreshSceneTree();
  refreshInspector();
  refreshMaterialAsset();
  refreshToolProperties(true);
  refreshAnimationPanel(true);
  updateSelectionState();
}


function getModelExportObjects() {
  const roots = selectedObjects.length ? selectedObjects : [...editorObjects.values()].filter(object => object.parent && object.isMesh);
  const out = [];
  const seen = new Set();
  for (const object of roots) {
    if (!object || seen.has(object.uuid)) continue;
    let hasSelectedAncestor = false;
    let current = object.parent;
    while (current) {
      if (roots.includes(current)) {
        hasSelectedAncestor = true;
        break;
      }
      current = current.parent;
    }
    if (!hasSelectedAncestor) {
      out.push(object);
      object.traverse?.(child => seen.add(child.uuid));
      seen.add(object.uuid);
    }
  }
  return out;
}

function exportModel(format = 'obj') {
  const previousViewMode = activeViewMode;
  const hadViewOverride = viewModeManager.isOverrideMode(previousViewMode);
  if (hadViewOverride) viewModeManager.restoreObjectMaterials();

  try {
    const objects = getModelExportObjects();
    if (!objects.length) {
      notify('Model Export: select at least one mesh, or keep mesh objects in the scene for full-scene export.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    const base = `3d-model-editor-model-${stamp}`;
    if (format === 'obj') {
      downloadTextFile(`${base}.obj`, exportOBJ(objects), 'text/plain');
      notify('Model exported as OBJ.');
    } else if (format === 'stl') {
      downloadTextFile(`${base}.stl`, exportSTL(objects), 'model/stl');
      notify('Model exported as STL.');
    } else if (format === 'glb') {
      downloadBlob(`${base}.glb`, exportGLBBlob(objects));
      notify('Model exported as GLB.');
    } else {
      downloadTextFile(`${base}.gltf`, exportGLTFText(objects), 'model/gltf+json');
      notify('Model exported as GLTF.');
    }
  } finally {
    if (hadViewOverride) viewModeManager.setMode(previousViewMode);
  }
}

async function importModelFile(file) {
  if (!file) return;
  const root = await importModelFileToObject(file);
  root.name = root.name || file.name.replace(/\.[^.]+$/, '') || 'Imported Model';
  commandManager.execute(new ImportModelCommand(root, `Import ${file.name}`));
  notify(`Imported model: ${file.name}`);
}

function requestModelImport(format = 'model') {
  if (!modelFileInput) return;
  modelFileInput.value = '';
  modelFileInput.dataset.modelFormat = format;
  if (format === 'obj') modelFileInput.accept = '.obj,text/plain';
  else if (format === 'stl') modelFileInput.accept = '.stl,model/stl,application/sla';
  else modelFileInput.accept = '.gltf,.glb,model/gltf+json,model/gltf-binary';
  modelFileInput.click();
}

function handleModelIoAction(action) {
  if (action === 'import-obj') requestModelImport('obj');
  else if (action === 'import-stl') requestModelImport('stl');
  else if (action === 'import-gltf') requestModelImport('gltf');
  else if (action === 'export-obj') exportModel('obj');
  else if (action === 'export-stl') exportModel('stl');
  else if (action === 'export-gltf') exportModel('gltf');
  else if (action === 'export-glb') exportModel('glb');
}

function exportProject(format = 'json') {
  const project = serializeProject();
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
  if (format === 'xml') {
    downloadTextFile(`3d-model-editor-project-${stamp}.xml`, projectJsonToXml(project), 'application/xml');
    notify('Project saved as XML.');
  } else {
    downloadTextFile(`3d-model-editor-project-${stamp}.json`, JSON.stringify(project, null, 2), 'application/json');
    notify('Project saved as JSON.');
  }
}

async function importProjectFile(file) {
  if (!file) return;
  const text = await readTextFile(file);
  const isXml = file.name.toLowerCase().endsWith('.xml') || text.trim().startsWith('<');
  const project = isXml ? projectXmlToJson(text) : JSON.parse(text);
  applyProjectData(project);
  commandManager.undoStack.length = 0;
  commandManager.redoStack.length = 0;
  updateUndoRedoUI();
  notify(`Project loaded from ${isXml ? 'XML' : 'JSON'}.`);
}

function requestProjectImport(format = 'json') {
  if (!projectFileInput) return;
  projectFileInput.value = '';
  projectFileInput.accept = format === 'xml' ? '.xml,application/xml,text/xml' : '.json,application/json';
  projectFileInput.dataset.projectFormat = format;
  projectFileInput.click();
}

function handleProjectIoAction(action) {
  if (action === 'save-json') exportProject('json');
  else if (action === 'save-xml') exportProject('xml');
  else if (action === 'load-json') requestProjectImport('json');
  else if (action === 'load-xml') requestProjectImport('xml');
}

function bindUI() {
  document.querySelectorAll('[data-add]').forEach(button => {
    button.addEventListener('click', () => {
      addByType(button.dataset.add);
      closeToolDropdowns();
    });
  });

  document.querySelectorAll('[data-model-tool]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      runModelingTool(button.dataset.modelTool, button.dataset.axis || 'x');
    });
  });

  fileMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    toolsMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    viewMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    createMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    const dropdown = fileMenuBtn.closest('.top-menu-dropdown');
    dropdown.classList.toggle('open');
  });

  document.querySelectorAll('[data-project-io]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handleProjectIoAction(button.dataset.projectIo);
      closeTopToolsMenu();
    });
  });

  document.querySelectorAll('[data-model-io]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handleModelIoAction(button.dataset.modelIo);
      closeTopToolsMenu();
    });
  });

  projectFileInput?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    importProjectFile(file).catch(error => {
      console.error(error);
      notify(`Project load failed: ${error.message || error}`);
    });
  });

  modelFileInput?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    importModelFile(file).catch(error => {
      console.error(error);
      notify(`Model import failed: ${error.message || error}`);
    });
  });

  viewMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    fileMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    toolsMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    viewMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    createMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    const dropdown = viewMenuBtn.closest('.top-menu-dropdown');
    dropdown.classList.toggle('open');
  });

  document.querySelectorAll('[data-camera-action]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.cameraAction === 'view-selected') viewThroughSelectedCamera();
      else if (button.dataset.cameraAction === 'exit-camera-view') exitCameraView();
      hideContextMenu();
      closeTopToolsMenu();
    });
  });

  document.querySelectorAll('[data-view-mode]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setViewMode(button.dataset.viewMode || 'material');
      hideContextMenu();
      closeTopToolsMenu();
    });
  });

  toolsMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    fileMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    viewMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    createMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    const dropdown = toolsMenuBtn.closest('.top-menu-dropdown');
    dropdown.classList.toggle('open');
  });

  createMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    toolsMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    fileMenuBtn?.closest('.top-menu-dropdown')?.classList.remove('open');
    const dropdown = createMenuBtn.closest('.top-menu-dropdown');
    dropdown.classList.toggle('open');
  });

  guideBtn?.addEventListener('click', openGuideModal);
  guideCloseBtn?.addEventListener('click', closeGuideModal);
  guideModal?.addEventListener('pointerdown', event => {
    if (event.target === guideModal) closeGuideModal();
  });

  objectMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    openToolFlyout(objectMenuBtn, objectOptions);
  });

  lightMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    openToolFlyout(lightMenuBtn, lightOptions);
  });

  cameraMenuBtn?.addEventListener('click', event => {
    event.stopPropagation();
    openToolFlyout(cameraMenuBtn, cameraOptions);
  });

  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setTransformMode(button.dataset.mode);
      hideContextMenu();
      closeTopToolsMenu();
    });
  });

  document.querySelectorAll('[data-select-tool]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setSelectTool(button.dataset.selectTool || 'select');
      hideContextMenu();
      closeTopToolsMenu();
    });
  });

  document.querySelectorAll('[data-edit-mode]').forEach(button => {
    button.addEventListener('click', () => {
      setEditMode(button.dataset.editMode);
      hideContextMenu();
    });
  });

  selectToolBtn?.addEventListener('click', () => setSelectTool('select'));

  document.querySelectorAll('[data-bottom-tab]').forEach(button => {
    button.addEventListener('click', () => switchBottomTab(button.dataset.bottomTab));
  });

  undoBtn.addEventListener('click', () => commandManager.undo());
  redoBtn.addEventListener('click', () => commandManager.redo());
  resetViewBtn.addEventListener('click', () => { if (activeCameraViewObject) setCameraObjectHelpersVisible(activeCameraViewObject, true); activeCameraViewObject = null; transform.camera = camera; updateCameraFrameOverlay(); resetView(); });
  clearSelectionBtn.addEventListener('click', clearAllSelections);
  deleteBtn.addEventListener('click', deleteSelected);

  const leftSplitter = document.getElementById('splitToolsViewport');
  if (leftSplitter && toolsPanel) makeHorizontalResize(leftSplitter, toolsPanel, 'left');
  makeHorizontalResize(document.getElementById('splitViewportHierarchy'), hierarchyPanel, 'right');
  makeVerticalResize(document.getElementById('splitViewportInspector'), inspectorPanel);

  window.addEventListener('resize', () => {
    resizeRenderer();
    hideContextMenu();
    closeToolDropdowns();
  });
  document.addEventListener('pointerdown', event => {
    if (!editorContextMenu.contains(event.target)) hideContextMenu();
    if ((!toolsPanel || !toolsPanel.contains(event.target)) && !event.target.closest?.('.tool-options')) closeToolDropdowns();
    if (!event.target.closest?.('.top-menu-dropdown')) closeTopToolsMenu();
  });
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      exportProject('json');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'o') {
      event.preventDefault();
      requestProjectImport('json');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'd') {
      event.preventDefault();
      runDuplicateTool();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) commandManager.redo();
      else commandManager.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      commandManager.redo();
      return;
    }
    if (event.code === 'Space' && !isTypingTarget(event.target)) {
      event.preventDefault();
      setAnimationPlaying(!animationState.playing);
      return;
    }
    if (event.key === 'Escape') {
      hideContextMenu();
      closeToolDropdowns();
      closeTopToolsMenu();
      closeGuideModal();
      setSelectTool('select');
    }
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Alt') setOrbitTemporaryEnabled(false);
  });
}

function animate() {
  requestAnimationFrame(animate);
  updateAnimationPlayback(performance.now());
  const viewportCamera = getViewportCamera();
  transform.camera = viewportCamera;
  if (!activeCameraViewObject || !activeCameraViewObject.parent) orbit.update();
  renderer.render(scene, viewportCamera);
}

bindUI();
createDefaultScene();
setTransformMode(currentTransformMode);
setSelectTool('select');
setEditMode('object', { keepSelection: true });
setViewMode(activeViewMode);
syncGridMeasurementSettings();
updateUndoRedoUI();
refreshMaterialAsset();
refreshToolProperties();
refreshAnimationPanel();
switchBottomTab('inspector');
resizeRenderer();
animate();
