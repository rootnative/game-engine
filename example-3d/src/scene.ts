import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  type System,
  type World,
} from '@rootnative/game-engine';
import {
  extractMeshDefs,
  type AmbientLightComponent,
  type CameraComponent,
  type DirectionalLightComponent,
  type MeshComponent,
  type MeshDef,
  type Transform3DComponent,
} from '@rootnative/game-engine/renderers/three';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Scene {
  readonly world: World;
  readonly systems: ReadonlyArray<System>;
  readonly meshes: ReadonlyArray<MeshDef>;
  readonly transform: Transform3DComponent;
  readonly mesh: MeshComponent;
  readonly camera: CameraComponent;
  readonly ambientLight: AmbientLightComponent;
  readonly directionalLight: DirectionalLightComponent;
}

export function loadScene(gltf?: GLTF): Scene {
  const world = createWorld({ capacity: 64 });
  const transform = defineComponent(world, {
    x: 'f32',
    y: 'f32',
    z: 'f32',
    rx: 'f32',
    ry: 'f32',
    rz: 'f32',
    sx: 'f32',
    sy: 'f32',
    sz: 'f32',
  });
  const mesh = defineComponent(world, { mesh: 'u32' });
  const camera = defineComponent(world, {
    fov: 'f32',
    near: 'f32',
    far: 'f32',
    active: 'u8',
  });
  const ambientLight = defineComponent(world, {
    color: 'u32',
    intensity: 'f32',
  });
  const directionalLight = defineComponent(world, {
    color: 'u32',
    intensity: 'f32',
  });

  // MeshStandardMaterial reacts to lights — the demo proves the ECS lights
  // actually drive shading (a normal-mapped material would render even with
  // no lights at all, so it wouldn't tell us anything).
  const meshes: MeshDef[] = [
    {
      geometry: new THREE.BoxGeometry(1, 1, 1),
      material: new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.4 }),
    },
  ];

  // Optional glTF mesh — when a parsed GLTF is supplied, append every mesh
  // node it contains to the meshes list. Index 1 onwards belongs to the glb.
  const gltfMeshStart = meshes.length;
  if (gltf) {
    meshes.push(...extractMeshDefs(gltf));
  }

  // Cube at origin (left side of frame at orbit a=0).
  const cube = createEntity(world);
  addComponent(world, cube, transform, {
    x: -1.2, y: 0, z: 0,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  });
  addComponent(world, cube, mesh, { mesh: 0 });

  // glTF box on the right side. Same animation system — we share the spin
  // mask with the procedural cube. Only added if a parsed gltf was supplied
  // (and at least one mesh was extracted from it).
  if (gltf && meshes.length > gltfMeshStart) {
    const gltfEntity = createEntity(world);
    addComponent(world, gltfEntity, transform, {
      x: 1.2, y: 0, z: 0,
      rx: 0, ry: 0, rz: 0,
      sx: 1, sy: 1, sz: 1,
    });
    addComponent(world, gltfEntity, mesh, { mesh: gltfMeshStart });
  }

  // Camera entity — orbits the cube via the camera system below.
  const camEntity = createEntity(world);
  addComponent(world, camEntity, transform, {
    x: 0, y: 0, z: 5,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  });
  addComponent(world, camEntity, camera, {
    fov: 60, near: 0.1, far: 1000, active: 1,
  });

  // Ambient light entity — fills shadows so the unlit side isn't pure black.
  const ambient = createEntity(world);
  addComponent(world, ambient, ambientLight, { color: 0x404040, intensity: 1.2 });

  // Directional light entity — primary key light from the upper-right.
  const dirLight = createEntity(world);
  addComponent(world, dirLight, transform, {
    x: 3, y: 4, z: 5,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  });
  addComponent(world, dirLight, directionalLight, {
    color: 0xffffff,
    intensity: 1.5,
  });

  const cubeMask = transform.bit | mesh.bit;
  const rotationSystem: System = (w, ctx) => {
    const dt = ctx.time.delta;
    const rx = transform.data.rx as Float32Array;
    const ry = transform.data.ry as Float32Array;
    const alive = w.alive;
    const maskArr = w.mask;
    const n = w.nextId;
    for (let i = 0; i < n; i++) {
      if (alive[i] !== 1 || (maskArr[i] & cubeMask) !== cubeMask) continue;
      // Skip the camera and lights — they share the transform component but
      // not the mesh component, so the mask check above already excludes them.
      rx[i] += 0.6 * dt;
      ry[i] += 0.9 * dt;
    }
  };

  // Camera orbit: park the camera on a circle of radius 5 around the origin
  // and advance the angle each tick. Demonstrates that sim systems own the
  // camera now — not setupScene, not a ref.
  const camMask = transform.bit | camera.bit;
  let camAngle = 0;
  const cameraSystem: System = (w, ctx) => {
    camAngle += 0.3 * ctx.time.delta;
    const tx = transform.data.x as Float32Array;
    const ty = transform.data.y as Float32Array;
    const tz = transform.data.z as Float32Array;
    const ry = transform.data.ry as Float32Array;
    const alive = w.alive;
    const maskArr = w.mask;
    const n = w.nextId;
    const radius = 5;
    for (let i = 0; i < n; i++) {
      if (alive[i] !== 1 || (maskArr[i] & camMask) !== camMask) continue;
      tx[i] = Math.sin(camAngle) * radius;
      ty[i] = 0;
      tz[i] = Math.cos(camAngle) * radius;
      // Default camera forward is -Z; rotating around Y by `camAngle` keeps
      // it pointed at the origin from anywhere on the orbit circle.
      ry[i] = camAngle;
    }
  };

  return {
    world,
    systems: [rotationSystem, cameraSystem],
    meshes,
    transform,
    mesh,
    camera,
    ambientLight,
    directionalLight,
  };
}
