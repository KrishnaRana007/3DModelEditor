import * as THREE from 'three';

/**
 * GridMeasurementManager owns editor grid sizing/unit display and lightweight
 * measuring overlays. The editor app forwards pointer hits to this manager when
 * the Grid / Measurement tool is active.
 */
export class GridMeasurementManager {
  constructor({ scene, baseGrid, notify = () => {} }) {
    this.scene = scene;
    this.baseGrid = baseGrid;
    this.notify = notify;
    this.group = new THREE.Group();
    this.group.name = 'Grid Measurement Overlay';
    this.group.userData.internal = true;
    this.scene.add(this.group);

    this.dynamicGrid = null;
    this.measurePoints = [];
    this.records = [];
    this.settings = {
      gridSize: 20,
      gridDivisions: 20,
      unitSystem: 'meter',
      mode: 'distance'
    };

    this.pointGeometry = new THREE.SphereGeometry(0.055, 12, 8);
    this.pointMaterial = new THREE.MeshBasicMaterial({ color: 0x40c7ff, depthTest: false, depthWrite: false });
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xffcc33, depthTest: false, transparent: true, opacity: 0.95 });
    this.angleMaterial = new THREE.LineBasicMaterial({ color: 0x9dff6e, depthTest: false, transparent: true, opacity: 0.95 });

    if (this.baseGrid) this.baseGrid.visible = false;
    this.applyGridSettings(this.settings);
  }

  unitLabel() {
    return ({ meter: 'm', centimeter: 'cm', millimeter: 'mm', inch: 'in', foot: 'ft' })[this.settings.unitSystem] || 'm';
  }

  unitFactor() {
    return ({ meter: 1, centimeter: 100, millimeter: 1000, inch: 39.3700787, foot: 3.2808399 })[this.settings.unitSystem] || 1;
  }

  formatDistance(worldDistance) {
    return `${(worldDistance * this.unitFactor()).toFixed(3)} ${this.unitLabel()}`;
  }

  applyGridSettings(settings = {}) {
    this.settings = { ...this.settings, ...settings };
    const size = Math.max(1, Number(this.settings.gridSize) || 20);
    const divisions = Math.max(1, Math.floor(Number(this.settings.gridDivisions) || 20));
    if (this.dynamicGrid) {
      this.scene.remove(this.dynamicGrid);
      this.dynamicGrid.geometry?.dispose?.();
      this.dynamicGrid.material?.dispose?.();
    }
    this.dynamicGrid = new THREE.GridHelper(size, divisions, 0x5b6775, 0x2c3540);
    this.dynamicGrid.name = `Grid ${size} / ${divisions}`;
    this.dynamicGrid.userData.internal = true;
    this.scene.add(this.dynamicGrid);
  }

  setMode(mode) {
    this.settings.mode = mode || 'distance';
    this.measurePoints = [];
  }

  clearMeasurements() {
    this.measurePoints = [];
    this.records.length = 0;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose?.();
      if (child.material?.map) child.material.map.dispose?.();
      child.material?.dispose?.();
    }
  }

  createPointMarker(point) {
    const marker = new THREE.Mesh(this.pointGeometry, this.pointMaterial.clone());
    marker.position.copy(point);
    marker.renderOrder = 2000;
    this.group.add(marker);
    return marker;
  }

  createLine(points, material = this.lineMaterial) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material.clone());
    line.renderOrder = 1999;
    this.group.add(line);
    return line;
  }

  createTextSprite(text, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(13, 17, 23, 0.82)';
    ctx.strokeStyle = 'rgba(110, 182, 255, 0.95)';
    ctx.lineWidth = 4;
    this.roundRect(ctx, 8, 16, 496, 86, 16);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 34px Inter, Arial, sans-serif';
    ctx.fillStyle = '#f5f8ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 60);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(1.8, 0.45, 1);
    sprite.renderOrder = 2001;
    this.group.add(sprite);
    return sprite;
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  addMeasurementPoint(point) {
    const mode = this.settings.mode || 'distance';
    this.measurePoints.push(point.clone());
    this.createPointMarker(point);

    if ((mode === 'distance' || mode === 'ruler') && this.measurePoints.length >= 2) {
      const [a, b] = this.measurePoints.slice(-2);
      this.createDistanceRecord(a, b, mode);
      this.measurePoints = [];
      return;
    }

    if (mode === 'angle' && this.measurePoints.length >= 3) {
      const [a, b, c] = this.measurePoints.slice(-3);
      this.createAngleRecord(a, b, c);
      this.measurePoints = [];
    }
  }

  createDistanceRecord(a, b, mode) {
    const line = this.createLine([a, b]);
    const mid = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.18, 0));
    const label = mode === 'ruler'
      ? `Ruler: ${this.formatDistance(a.distanceTo(b))}`
      : this.formatDistance(a.distanceTo(b));
    const sprite = this.createTextSprite(label, mid);
    this.records.push({ type: mode, points: [a.clone(), b.clone()], objects: [line, sprite] });
    this.notify(`${label}`);
  }

  createAngleRecord(a, b, c) {
    const ab = a.clone().sub(b).normalize();
    const cb = c.clone().sub(b).normalize();
    const angle = THREE.MathUtils.radToDeg(ab.angleTo(cb));
    const line1 = this.createLine([b, a], this.angleMaterial);
    const line2 = this.createLine([b, c], this.angleMaterial);
    const labelPos = b.clone().add(a).add(c).multiplyScalar(1 / 3).add(new THREE.Vector3(0, 0.22, 0));
    const sprite = this.createTextSprite(`${angle.toFixed(2)}°`, labelPos);
    this.records.push({ type: 'angle', points: [a.clone(), b.clone(), c.clone()], objects: [line1, line2, sprite] });
    this.notify(`Angle: ${angle.toFixed(2)}°`);
  }
}
