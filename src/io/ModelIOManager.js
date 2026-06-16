import * as THREE from 'three';

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function readArrayBufferFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Unable to read model file.'));
    reader.readAsArrayBuffer(file);
  });
}

export function readTextFromArrayBuffer(buffer) {
  return new TextDecoder().decode(buffer);
}

export function getFileExtension(fileOrName) {
  const name = String(fileOrName?.name || fileOrName || '').toLowerCase();
  return name.includes('.') ? name.split('.').pop() : '';
}

function safeName(name, fallback = 'Model') {
  return String(name || fallback).replace(/[^a-z0-9_\- .]/gi, '_');
}

function defaultMaterial(name = 'Imported Material', color = 0xb7c7d8) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  mat.name = name;
  return mat;
}

function geometryToNonIndexed(mesh) {
  const source = mesh.geometry;
  if (!source?.attributes?.position) return null;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return geometry;
}

function collectMeshes(objects) {
  const meshes = [];
  const seen = new Set();
  for (const root of objects || []) {
    if (!root) continue;
    root.updateMatrixWorld?.(true);
    root.traverse?.(child => {
      if (child.isMesh && child.geometry?.attributes?.position && !seen.has(child.uuid)) {
        seen.add(child.uuid);
        meshes.push(child);
      }
    });
    if (root.isMesh && root.geometry?.attributes?.position && !seen.has(root.uuid)) {
      seen.add(root.uuid);
      meshes.push(root);
    }
  }
  return meshes;
}

function triangulatedWorldTriangles(mesh) {
  const geometry = geometryToNonIndexed(mesh);
  if (!geometry) return [];
  const pos = geometry.attributes.position;
  const triangles = [];
  const normal = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
    normal.copy(b).sub(a).cross(new THREE.Vector3().copy(c).sub(a)).normalize();
    triangles.push({ a, b, c, normal: normal.clone() });
  }
  geometry.dispose?.();
  return triangles;
}

function parseOBJIndex(token, vertices, uvs, normals) {
  const [vRaw, vtRaw, vnRaw] = token.split('/');
  const parse = (raw, list) => {
    if (!raw) return null;
    const value = parseInt(raw, 10);
    if (!Number.isFinite(value)) return null;
    return value < 0 ? list.length + value : value - 1;
  };
  return { v: parse(vRaw, vertices), vt: parse(vtRaw, uvs), vn: parse(vnRaw, normals) };
}

export function parseOBJ(text, options = {}) {
  const vertices = [];
  const uvs = [];
  const normals = [];
  const outPos = [];
  const outUv = [];
  const outNormal = [];
  let objectName = options.name || 'Imported OBJ';

  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts.shift();
    if (key === 'o' || key === 'g') {
      if (parts.length && objectName === (options.name || 'Imported OBJ')) objectName = parts.join(' ');
    } else if (key === 'v') {
      vertices.push(new THREE.Vector3(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0));
    } else if (key === 'vt') {
      uvs.push(new THREE.Vector2(Number(parts[0]) || 0, Number(parts[1]) || 0));
    } else if (key === 'vn') {
      normals.push(new THREE.Vector3(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0));
    } else if (key === 'f' && parts.length >= 3) {
      const refs = parts.map(token => parseOBJIndex(token, vertices, uvs, normals));
      for (let i = 1; i < refs.length - 1; i++) {
        for (const ref of [refs[0], refs[i], refs[i + 1]]) {
          const v = vertices[ref.v] || new THREE.Vector3();
          outPos.push(v.x, v.y, v.z);
          const vt = ref.vt != null ? uvs[ref.vt] : null;
          if (vt) outUv.push(vt.x, vt.y);
          const vn = ref.vn != null ? normals[ref.vn] : null;
          if (vn) outNormal.push(vn.x, vn.y, vn.z);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  if (outUv.length === (outPos.length / 3) * 2) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  if (outNormal.length === outPos.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(outNormal, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, defaultMaterial('OBJ Material', 0xc7d6e5));
  mesh.name = safeName(objectName, 'Imported OBJ');
  return mesh;
}

export function exportOBJ(objects) {
  const meshes = collectMeshes(objects);
  let text = '# Exported from 3D Model Editor\n';
  let vertexOffset = 1;
  for (const mesh of meshes) {
    const geometry = geometryToNonIndexed(mesh);
    if (!geometry) continue;
    mesh.updateMatrixWorld(true);
    text += `\no ${safeName(mesh.name, 'Mesh')}\n`;
    const pos = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      text += `v ${v.x} ${v.y} ${v.z}\n`;
    }
    if (uv) {
      for (let i = 0; i < uv.count; i++) text += `vt ${uv.getX(i)} ${uv.getY(i)}\n`;
    }
    if (normal) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (let i = 0; i < normal.count; i++) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        text += `vn ${n.x} ${n.y} ${n.z}\n`;
      }
    }
    for (let i = 0; i < pos.count; i += 3) {
      const a = vertexOffset + i;
      const b = vertexOffset + i + 1;
      const c = vertexOffset + i + 2;
      if (uv && normal) text += `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`;
      else if (uv) text += `f ${a}/${a} ${b}/${b} ${c}/${c}\n`;
      else if (normal) text += `f ${a}//${a} ${b}//${b} ${c}//${c}\n`;
      else text += `f ${a} ${b} ${c}\n`;
    }
    vertexOffset += pos.count;
    geometry.dispose?.();
  }
  return text;
}

function looksLikeAsciiSTL(text) {
  return /^\s*solid\b/i.test(text) && /\bfacet\s+normal\b/i.test(text);
}

function parseAsciiSTL(text, name = 'Imported STL') {
  const positions = [];
  const normals = [];
  let currentNormal = new THREE.Vector3(0, 1, 0);
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const normalMatch = line.match(/^facet\s+normal\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/i);
    if (normalMatch) currentNormal = new THREE.Vector3(Number(normalMatch[1]) || 0, Number(normalMatch[2]) || 0, Number(normalMatch[3]) || 0);
    const vertexMatch = line.match(/^vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/i);
    if (vertexMatch) {
      positions.push(Number(vertexMatch[1]) || 0, Number(vertexMatch[2]) || 0, Number(vertexMatch[3]) || 0);
      normals.push(currentNormal.x, currentNormal.y, currentNormal.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, defaultMaterial('STL Material', 0xd8d8d8));
  mesh.name = safeName(name, 'Imported STL');
  return mesh;
}

function parseBinarySTL(buffer, name = 'Imported STL') {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const positions = [];
  const normals = [];
  let offset = 84;
  for (let i = 0; i < count && offset + 50 <= view.byteLength; i++) {
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;
    for (let v = 0; v < 3; v++) {
      positions.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      normals.push(nx, ny, nz);
      offset += 12;
    }
    offset += 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, defaultMaterial('STL Material', 0xd8d8d8));
  mesh.name = safeName(name, 'Imported STL');
  return mesh;
}

export function parseSTL(buffer, options = {}) {
  const textStart = readTextFromArrayBuffer(buffer.slice(0, Math.min(buffer.byteLength, 512)));
  if (looksLikeAsciiSTL(textStart)) return parseAsciiSTL(readTextFromArrayBuffer(buffer), options.name);
  return parseBinarySTL(buffer, options.name);
}

export function exportSTL(objects) {
  const meshes = collectMeshes(objects);
  let text = 'solid 3d_model_editor\n';
  for (const mesh of meshes) {
    for (const tri of triangulatedWorldTriangles(mesh)) {
      text += `  facet normal ${tri.normal.x} ${tri.normal.y} ${tri.normal.z}\n`;
      text += '    outer loop\n';
      text += `      vertex ${tri.a.x} ${tri.a.y} ${tri.a.z}\n`;
      text += `      vertex ${tri.b.x} ${tri.b.y} ${tri.b.z}\n`;
      text += `      vertex ${tri.c.x} ${tri.c.y} ${tri.c.z}\n`;
      text += '    endloop\n';
      text += '  endfacet\n';
    }
  }
  text += 'endsolid 3d_model_editor\n';
  return text;
}

function base64FromUint8(uint8) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function align4(value) { return (value + 3) & ~3; }

function pushBytes(chunks, uint8) {
  const pad = align4(uint8.byteLength) - uint8.byteLength;
  chunks.push(uint8);
  if (pad) chunks.push(new Uint8Array(pad));
}

function floatArrayToUint8(values) {
  const array = new Float32Array(values);
  return new Uint8Array(array.buffer);
}

function accessorMinMax(values, itemSize) {
  const min = Array(itemSize).fill(Infinity);
  const max = Array(itemSize).fill(-Infinity);
  for (let i = 0; i < values.length; i += itemSize) {
    for (let j = 0; j < itemSize; j++) {
      const value = values[i + j];
      min[j] = Math.min(min[j], value);
      max[j] = Math.max(max[j], value);
    }
  }
  return { min, max };
}

function materialToGltf(material) {
  const color = material?.color ? material.color : new THREE.Color(0xb7c7d8);
  const opacity = material?.opacity ?? 1;
  const roughness = material?.roughness ?? 0.55;
  const metalness = material?.metalness ?? 0.05;
  return {
    name: material?.name || material?.type || 'Material',
    pbrMetallicRoughness: {
      baseColorFactor: [color.r, color.g, color.b, opacity],
      metallicFactor: metalness,
      roughnessFactor: roughness
    },
    alphaMode: opacity < 1 || material?.transparent ? 'BLEND' : 'OPAQUE'
  };
}

export function exportGLTFDocument(objects, options = {}) {
  const meshes = collectMeshes(objects);
  const bufferChunks = [];
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const gltfMeshes = [];
  const nodes = [];
  const sceneNodes = [];
  let byteOffset = 0;

  function addAccessor(values, itemSize, type, target = 34962) {
    const bytes = floatArrayToUint8(values);
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target });
    pushBytes(bufferChunks, bytes);
    const aligned = align4(bytes.byteLength);
    byteOffset += aligned;
    const { min, max } = accessorMinMax(values, itemSize);
    const accessor = { bufferView: viewIndex, componentType: 5126, count: values.length / itemSize, type };
    if (type === 'VEC3') Object.assign(accessor, { min, max });
    accessors.push(accessor);
    return accessors.length - 1;
  }

  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const geometry = geometryToNonIndexed(mesh);
    if (!geometry) continue;
    const pos = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const positions = [];
    const normals = [];
    const uvs = [];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
      if (normal) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        normals.push(n.x, n.y, n.z);
      }
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
    }
    const attributes = { POSITION: addAccessor(positions, 3, 'VEC3') };
    if (normals.length === positions.length) attributes.NORMAL = addAccessor(normals, 3, 'VEC3');
    if (uvs.length === (positions.length / 3) * 2) attributes.TEXCOORD_0 = addAccessor(uvs, 2, 'VEC2');
    const matIndex = materials.length;
    materials.push(materialToGltf(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material));
    const meshIndex = gltfMeshes.length;
    gltfMeshes.push({ name: mesh.name || 'Mesh', primitives: [{ attributes, mode: 4, material: matIndex }] });
    const nodeIndex = nodes.length;
    nodes.push({ name: mesh.name || 'Mesh', mesh: meshIndex });
    sceneNodes.push(nodeIndex);
    geometry.dispose?.();
  }

  const total = bufferChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bin = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of bufferChunks) {
    bin.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const gltf = {
    asset: { version: '2.0', generator: '3D Model Editor' },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes: gltfMeshes,
    materials,
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews,
    accessors
  };

  if (!options.binary) {
    gltf.buffers[0].uri = `data:application/octet-stream;base64,${base64FromUint8(bin)}`;
  }
  return { gltf, bin };
}

export function exportGLTFText(objects) {
  const { gltf } = exportGLTFDocument(objects, { binary: false });
  return JSON.stringify(gltf, null, 2);
}

function paddedJsonBytes(json) {
  const bytes = new TextEncoder().encode(json);
  const padded = new Uint8Array(align4(bytes.byteLength));
  padded.set(bytes);
  for (let i = bytes.byteLength; i < padded.byteLength; i++) padded[i] = 0x20;
  return padded;
}

export function exportGLBBlob(objects) {
  const { gltf, bin } = exportGLTFDocument(objects, { binary: true });
  const jsonBytes = paddedJsonBytes(JSON.stringify(gltf));
  const binBytes = new Uint8Array(align4(bin.byteLength));
  binBytes.set(bin);
  const totalLength = 12 + 8 + jsonBytes.byteLength + 8 + binBytes.byteLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint32(offset, 0x46546c67, true); offset += 4; // glTF
  view.setUint32(offset, 2, true); offset += 4;
  view.setUint32(offset, totalLength, true); offset += 4;
  view.setUint32(offset, jsonBytes.byteLength, true); offset += 4;
  view.setUint32(offset, 0x4E4F534A, true); offset += 4; // JSON
  new Uint8Array(buffer, offset, jsonBytes.byteLength).set(jsonBytes); offset += jsonBytes.byteLength;
  view.setUint32(offset, binBytes.byteLength, true); offset += 4;
  view.setUint32(offset, 0x004E4942, true); offset += 4; // BIN
  new Uint8Array(buffer, offset, binBytes.byteLength).set(binBytes);
  return new Blob([buffer], { type: 'model/gltf-binary' });
}

function dataUriToArrayBuffer(uri) {
  const comma = uri.indexOf(',');
  const base64 = comma >= 0 ? uri.slice(comma + 1) : uri;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parseGLB(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB header.');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error('Only GLB version 2 is supported.');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true); offset += 4;
    const type = view.getUint32(offset, true); offset += 4;
    const chunk = buffer.slice(offset, offset + length);
    offset += length;
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk).trim());
    else if (type === 0x004E4942) bin = chunk;
  }
  if (!json) throw new Error('GLB does not contain a JSON chunk.');
  return { json, binaryChunk: bin };
}

function componentCount(type) {
  return ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 })[type] || 1;
}

function componentArrayType(componentType) {
  return ({ 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array, 5122: Int16Array })[componentType] || Float32Array;
}

function accessorToArray(gltf, buffers, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) return null;
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const buffer = buffers[view.buffer || 0];
  const ArrayType = componentArrayType(accessor.componentType);
  const itemSize = componentCount(accessor.type);
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const length = accessor.count * itemSize;
  if (view.byteStride && view.byteStride !== itemSize * ArrayType.BYTES_PER_ELEMENT) {
    const packed = new ArrayType(length);
    const sourceView = new DataView(buffer, view.byteOffset || 0, view.byteLength);
    for (let i = 0; i < accessor.count; i++) {
      for (let j = 0; j < itemSize; j++) {
        const itemOffset = (accessor.byteOffset || 0) + i * view.byteStride + j * ArrayType.BYTES_PER_ELEMENT;
        if (accessor.componentType === 5126) packed[i * itemSize + j] = sourceView.getFloat32(itemOffset, true);
        else if (accessor.componentType === 5125) packed[i * itemSize + j] = sourceView.getUint32(itemOffset, true);
        else if (accessor.componentType === 5123) packed[i * itemSize + j] = sourceView.getUint16(itemOffset, true);
        else packed[i * itemSize + j] = sourceView.getUint8(itemOffset);
      }
    }
    return { array: packed, itemSize, componentType: accessor.componentType, count: accessor.count };
  }
  return { array: new ArrayType(buffer, byteOffset, length).slice(), itemSize, componentType: accessor.componentType, count: accessor.count };
}

function gltfMaterialToThree(material) {
  const pbr = material?.pbrMetallicRoughness || {};
  const factor = pbr.baseColorFactor || [0.72, 0.78, 0.85, 1];
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(factor[0], factor[1], factor[2]),
    opacity: factor[3] ?? 1,
    transparent: (factor[3] ?? 1) < 1 || material?.alphaMode === 'BLEND',
    roughness: pbr.roughnessFactor ?? 0.55,
    metalness: pbr.metallicFactor ?? 0.05,
    side: THREE.DoubleSide
  });
  mat.name = material?.name || 'GLTF Material';
  return mat;
}

function createNodeObject(gltf, buffers, nodeIndex, materials) {
  const node = gltf.nodes?.[nodeIndex] || {};
  let object = new THREE.Object3D();
  if (node.mesh != null && gltf.meshes?.[node.mesh]) {
    const meshDef = gltf.meshes[node.mesh];
    const group = new THREE.Group();
    group.name = node.name || meshDef.name || 'GLTF Mesh';
    for (const prim of meshDef.primitives || []) {
      const geometry = new THREE.BufferGeometry();
      const attrs = prim.attributes || {};
      const pos = accessorToArray(gltf, buffers, attrs.POSITION);
      if (!pos) continue;
      geometry.setAttribute('position', new THREE.BufferAttribute(pos.array, pos.itemSize));
      const normal = accessorToArray(gltf, buffers, attrs.NORMAL);
      if (normal) geometry.setAttribute('normal', new THREE.BufferAttribute(normal.array, normal.itemSize));
      const uv = accessorToArray(gltf, buffers, attrs.TEXCOORD_0);
      if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv.array, uv.itemSize));
      const indices = accessorToArray(gltf, buffers, prim.indices);
      if (indices) geometry.setIndex(new THREE.BufferAttribute(indices.array, 1));
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[prim.material] || defaultMaterial('GLTF Material'));
      mesh.name = prim.name || meshDef.name || node.name || 'GLTF Mesh';
      group.add(mesh);
    }
    object = group.children.length === 1 ? group.children[0] : group;
  }
  object.name = node.name || object.name || 'GLTF Node';
  if (node.matrix?.length === 16) object.matrix.fromArray(node.matrix), object.matrix.decompose(object.position, object.quaternion, object.scale);
  else {
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
  }
  for (const childIndex of node.children || []) object.add(createNodeObject(gltf, buffers, childIndex, materials));
  return object;
}

export function parseGLTFOrGLB(buffer, options = {}) {
  let gltf;
  let binaryChunk = null;
  const ext = String(options.extension || '').toLowerCase();
  if (ext === 'glb') ({ json: gltf, binaryChunk } = parseGLB(buffer));
  else gltf = JSON.parse(readTextFromArrayBuffer(buffer));

  const buffers = (gltf.buffers || []).map((buf, index) => {
    if (buf.uri?.startsWith('data:')) return dataUriToArrayBuffer(buf.uri);
    if (index === 0 && binaryChunk) return binaryChunk;
    throw new Error('This starter importer supports embedded GLTF buffers and GLB binary chunks only.');
  });
  const materials = (gltf.materials || []).map(gltfMaterialToThree);
  const root = new THREE.Group();
  root.name = options.name || 'Imported GLTF';
  const sceneDef = gltf.scenes?.[gltf.scene || 0] || gltf.scenes?.[0];
  const nodes = sceneDef?.nodes || gltf.nodes?.map((_, i) => i) || [];
  for (const nodeIndex of nodes) root.add(createNodeObject(gltf, buffers, nodeIndex, materials));
  return root.children.length === 1 ? root.children[0] : root;
}

export async function importModelFileToObject(file) {
  const extension = getFileExtension(file);
  const buffer = await readArrayBufferFile(file);
  const baseName = safeName(file.name.replace(/\.[^.]+$/, ''), 'Imported Model');
  if (extension === 'obj') return parseOBJ(readTextFromArrayBuffer(buffer), { name: baseName });
  if (extension === 'stl') return parseSTL(buffer, { name: baseName });
  if (extension === 'gltf' || extension === 'glb') return parseGLTFOrGLB(buffer, { extension, name: baseName });
  throw new Error(`Unsupported model format: .${extension}`);
}
