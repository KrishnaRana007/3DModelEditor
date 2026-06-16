import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

/**
 * SceneManager owns the Three.js runtime: renderer, scene, camera, controls,
 * transform gizmo, helper grid/axes and visual overlay groups/materials.
 *
 * New viewport-level Three.js setup should be added here, not in UI/tool files.
 */
export function createSceneManager({ viewport }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.max(viewport.clientWidth, 1), Math.max(viewport.clientHeight, 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x151719, 1);
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.name = 'Scene';
  scene.background = new THREE.Color(0x151719);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(6, 5, 7);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.enablePan = true;
  orbit.enableZoom = true;
  orbit.screenSpacePanning = true;
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN
  };
  orbit.target.set(0, 0, 0);
  orbit.enabled = false;
  orbit.update();

  const transform = new TransformControls(camera, renderer.domElement);
  transform.setMode('translate');
  transform.setSize(1.0);
  transform.addEventListener('dragging-changed', event => {
    if (event.value) orbit.enabled = false;
  });
  scene.add(transform);

  const selectionPivot = new THREE.Object3D();
  selectionPivot.name = 'Selection Pivot';
  selectionPivot.userData.internal = true;
  scene.add(selectionPivot);

  const componentOverlayGroup = new THREE.Group();
  componentOverlayGroup.name = 'Component Selection Overlay';
  componentOverlayGroup.userData.internal = true;
  scene.add(componentOverlayGroup);

  const componentHoverOverlayGroup = new THREE.Group();
  componentHoverOverlayGroup.name = 'Component Hover Overlay';
  componentHoverOverlayGroup.userData.internal = true;
  scene.add(componentHoverOverlayGroup);

  const objectWireOverlayGroup = new THREE.Group();
  objectWireOverlayGroup.name = 'Object Wire Selection Overlay';
  objectWireOverlayGroup.userData.internal = true;
  scene.add(objectWireOverlayGroup);

  const objectWireMaterial = new THREE.LineBasicMaterial({
    color: 0x6eb6ff,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false
  });

  const faceOverlayMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8f00,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });

  const faceHoverMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff66,
    transparent: true,
    opacity: 0.32,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });

  const edgeOverlayMaterial = new THREE.LineBasicMaterial({
    color: 0x20e070,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false
  });

  const edgeHoverMaterial = new THREE.LineBasicMaterial({
    color: 0xffff66,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false
  });

  const vertexOverlayMaterial = new THREE.MeshBasicMaterial({
    color: 0x55c7ff,
    depthTest: false,
    depthWrite: false
  });

  const vertexHoverMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff66,
    depthTest: false,
    depthWrite: false
  });

  const vertexOverlayGeometry = new THREE.SphereGeometry(0.055, 12, 8);
  const vertexHoverGeometry = new THREE.SphereGeometry(0.072, 12, 8);

  const grid = new THREE.GridHelper(20, 20, 0x45515d, 0x28313a);
  grid.name = 'Grid';
  grid.userData.internal = true;
  scene.add(grid);

  const axes = new THREE.AxesHelper(3);
  axes.name = 'Axes';
  axes.userData.internal = true;
  scene.add(axes);

  function resize() {
    const width = Math.max(viewport.clientWidth, 1);
    const height = Math.max(viewport.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  return {
    renderer,
    scene,
    camera,
    orbit,
    transform,
    selectionPivot,
    componentOverlayGroup,
    componentHoverOverlayGroup,
    objectWireOverlayGroup,
    objectWireMaterial,
    faceOverlayMaterial,
    faceHoverMaterial,
    edgeOverlayMaterial,
    edgeHoverMaterial,
    vertexOverlayMaterial,
    vertexHoverMaterial,
    vertexOverlayGeometry,
    vertexHoverGeometry,
    grid,
    axes,
    resize
  };
}
