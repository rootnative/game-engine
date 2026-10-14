import { File } from 'expo-file-system';
import { use } from 'react';
import * as THREE from 'three';
// three.js's `exports` field maps `./examples/jsm/*` straight through to
// `./examples/jsm/*`, so the `.js` extension is required — Metro's bundler
// resolves the path verbatim and would warn / error on extensionless paths
// the same way it does for `expo-three`'s loader barrel.
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { loadAsset, type AssetSource } from '../../assets';
import type { MeshDef } from './ThreeRenderer';

// React Native polyfills `navigator` (so `typeof navigator !== 'undefined'`
// is true) but does not set `userAgent`. GLTFParser's constructor branches
// on `navigator.userAgent.match(...)` to feature-detect Safari/Firefox image
// pipelines and crashes with `Cannot read property 'match' of undefined`.
// Stub a non-empty string before any parser is constructed so those regex
// tests fall through and the parser picks the plain `TextureLoader` path.
if (
  typeof navigator !== 'undefined' &&
  typeof (navigator as { userAgent?: unknown }).userAgent !== 'string'
) {
  (navigator as { userAgent?: string }).userAgent = 'react-native';
}

const inflight = new Map<AssetSource, Promise<GLTF>>();

/**
 * Decode a `.glb` (or `.gltf` with embedded resources) into a parsed `GLTF`.
 *
 * Bridges the engine asset pipeline to three.js's `GLTFLoader` by reading the
 * resolved local file's bytes via `expo-file-system` and handing them to
 * `loader.parse()`. Per-source dedupe — multiple calls with the same source
 * share one in-flight promise, so this is safe to call from `useGltf` /
 * Suspense boundaries.
 *
 * **`.glb` is the supported path.** A `.gltf` file that references external
 * `.bin` / image resources is not handled — the loader's resource manager
 * isn't wired to resolve sibling files through the asset pipeline. Convert
 * to `.glb` (single-file binary) at export time, or open an issue.
 */
export function loadGltf(source: AssetSource): Promise<GLTF> {
  let p = inflight.get(source);
  if (!p) {
    p = resolveGltf(source);
    inflight.set(source, p);
  }
  return p;
}

/** Suspense-friendly variant. Calls `use()` on the cached promise. */
export function useGltf(source: AssetSource): GLTF {
  return use(loadGltf(source));
}

async function resolveGltf(source: AssetSource): Promise<GLTF> {
  const asset = await loadAsset(source);
  const ab = await new File(asset.localUri).arrayBuffer();
  const loader = new GLTFLoader();
  return new Promise<GLTF>((resolve, reject) => {
    loader.parse(ab, '/', resolve, reject);
  });
}

/**
 * Walk a parsed `GLTF` scene and pull every mesh out as a `MeshDef` suitable
 * for `<ThreeRenderer>`'s `meshes` prop. Order is depth-first traversal —
 * `MeshDef` index N corresponds to the Nth mesh encountered.
 *
 * **World-space transforms are dropped.** Only `geometry` and `material` are
 * captured; the position/rotation/scale of the original node and any parent
 * transforms above it are not preserved. If you need the glTF's hierarchy,
 * attach `gltf.scene` directly via `setupScene` instead of routing meshes
 * through the ECS.
 */
export function extractMeshDefs(gltf: GLTF): MeshDef[] {
  const out: MeshDef[] = [];
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      out.push({ geometry: mesh.geometry, material: mesh.material });
    }
  });
  return out;
}
