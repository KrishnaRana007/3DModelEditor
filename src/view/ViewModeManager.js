import * as THREE from 'three';

/**
 * ViewModeManager controls viewport display-only modes without mutating real
 * object materials. The editor can therefore save/export materials safely even
 * while Wireframe, X-Ray, Normal or UV debug views are active.
 */
export class ViewModeManager {
  constructor({ scene, renderer, getMeshObjects, notify }) {
    this.scene = scene;
    this.renderer = renderer;
    this.getMeshObjects = getMeshObjects;
    this.notify = notify;
    this.mode = 'material';
    this.defaultToneMapping = renderer.toneMapping;
    this.defaultExposure = renderer.toneMappingExposure;
    this.originalMaterials = new Map();

    this.materials = {
      solid: new THREE.MeshStandardMaterial({
        name: 'View Solid Override',
        color: 0xb8c2d0,
        roughness: 0.72,
        metalness: 0.0,
        side: THREE.DoubleSide
      }),
      wireframe: new THREE.MeshBasicMaterial({
        name: 'View Wireframe Override',
        color: 0x8cc8ff,
        wireframe: true,
        side: THREE.DoubleSide
      }),
      xray: new THREE.MeshBasicMaterial({
        name: 'View X-Ray Override',
        color: 0x87cfff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide
      }),
      normal: new THREE.MeshNormalMaterial({
        name: 'View Normal Override',
        side: THREE.DoubleSide
      }),
      uv: this.createUvDebugMaterial()
    };
  }

  createUvDebugMaterial() {
    return new THREE.ShaderMaterial({
      name: 'View UV Debug Override',
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          vec2 wrapped = fract(vUv);
          vec3 uvColor = vec3(wrapped.x, wrapped.y, 1.0 - wrapped.x * 0.55);
          vec2 cell = fract(vUv * 10.0);
          float line = 0.0;
          line = max(line, 1.0 - step(0.035, cell.x));
          line = max(line, 1.0 - step(0.035, cell.y));
          line = max(line, step(0.965, cell.x));
          line = max(line, step(0.965, cell.y));
          vec3 finalColor = mix(uvColor, vec3(1.0), clamp(line * 0.75, 0.0, 1.0));
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });
  }

  ensureGeneratedUvs() {
    for (const mesh of this.getMeshObjects()) {
      const geometry = mesh.geometry;
      const pos = geometry?.attributes?.position;
      if (!geometry || !pos || geometry.attributes.uv) continue;

      geometry.computeBoundingBox?.();
      const box = geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
      const size = new THREE.Vector3();
      box.getSize(size);
      const min = box.min;
      const sx = Math.abs(size.x) < 1e-8 ? 1 : size.x;
      const sz = Math.abs(size.z) < 1e-8 ? 1 : size.z;
      const uv = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        uv.push((x - min.x) / sx, (z - min.z) / sz);
      }
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.attributes.uv.needsUpdate = true;
    }
  }

  isOverrideMode(mode = this.mode) {
    return ['solid', 'wireframe', 'xray', 'normal', 'uv'].includes(mode);
  }

  restoreObjectMaterials() {
    for (const [mesh, material] of this.originalMaterials.entries()) {
      if (mesh && mesh.material !== material) mesh.material = material;
    }
    this.originalMaterials.clear();
  }

  getRealMaterial(mesh) {
    return this.originalMaterials.get(mesh) || mesh?.material || null;
  }

  applyOverrideMaterial(material) {
    for (const mesh of this.getMeshObjects()) {
      if (!mesh?.isMesh || !mesh.material) continue;
      if (!this.originalMaterials.has(mesh)) this.originalMaterials.set(mesh, mesh.material);
      mesh.material = material;
    }
  }

  setMode(mode) {
    const allowed = ['solid', 'wireframe', 'material', 'rendered', 'xray', 'normal', 'uv'];
    if (!allowed.includes(mode)) mode = 'material';
    this.mode = mode;

    this.scene.overrideMaterial = null;
    this.restoreObjectMaterials();
    this.renderer.toneMapping = this.defaultToneMapping;
    this.renderer.toneMappingExposure = this.defaultExposure;

    if (mode === 'solid') {
      this.applyOverrideMaterial(this.materials.solid);
    } else if (mode === 'wireframe') {
      this.applyOverrideMaterial(this.materials.wireframe);
    } else if (mode === 'xray') {
      this.applyOverrideMaterial(this.materials.xray);
    } else if (mode === 'normal') {
      this.applyOverrideMaterial(this.materials.normal);
    } else if (mode === 'uv') {
      this.ensureGeneratedUvs();
      this.applyOverrideMaterial(this.materials.uv);
    } else if (mode === 'rendered') {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
    }

    this.notify?.(`View Mode: ${this.getLabel(mode)}`);
  }

  getLabel(mode = this.mode) {
    return {
      solid: 'Solid',
      wireframe: 'Wireframe',
      material: 'Material Preview',
      rendered: 'Rendered Preview',
      xray: 'X-Ray',
      normal: 'Normal',
      uv: 'UV'
    }[mode] || 'Material Preview';
  }
}
