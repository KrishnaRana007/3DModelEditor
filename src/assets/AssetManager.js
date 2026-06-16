/**
 * Asset/material metadata and future asset-loading home.
 *
 * Material UI and material factory code should live here as the project grows.
 */
export const MATERIAL_TYPES = [
  { value: 'MeshBasicMaterial', label: 'Mesh Basic Material' },
  { value: 'MeshLambertMaterial', label: 'Mesh Lambert Material' },
  { value: 'MeshPhongMaterial', label: 'Mesh Phong Material' },
  { value: 'MeshStandardMaterial', label: 'Mesh Standard Material' },
  { value: 'MeshPhysicalMaterial', label: 'Mesh Physical Material' },
  { value: 'MeshToonMaterial', label: 'Mesh Toon Material' },
  { value: 'MeshMatcapMaterial', label: 'Mesh Matcap Material' },
  { value: 'MeshNormalMaterial', label: 'Mesh Normal Material' },
  { value: 'MeshDepthMaterial', label: 'Mesh Depth Material' },
  { value: 'MeshDistanceMaterial', label: 'Mesh Distance Material' },
  { value: 'ShadowMaterial', label: 'Shadow Material' }
];

export function materialTypeLabel(type) {
  return MATERIAL_TYPES.find(item => item.value === type)?.label || type || 'Material';
}

export class AssetManager {
  constructor() {
    this.textures = new Map();
    this.materials = new Map();
  }

  registerTexture(id, texture) {
    this.textures.set(id, texture);
    return texture;
  }

  getTexture(id) {
    return this.textures.get(id) || null;
  }

  registerMaterial(id, material) {
    this.materials.set(id, material);
    return material;
  }

  getMaterial(id) {
    return this.materials.get(id) || null;
  }
}
