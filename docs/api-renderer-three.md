# Three.js renderer

```ts
import { ThreeRenderer } from '@onlynative/game-engine/renderers/three';
import type {
  ThreeRendererProps,
  Transform3DComponent,
  MeshComponent,
  MeshDef,
  CameraComponent,
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
} from '@onlynative/game-engine/renderers/three';
```

A 3D renderer built on `expo-gl` + `expo-three`. Lives behind a subpath import so consumers who use a different renderer never pull `three` / `expo-gl` / `expo-three` into their bundle. The peer dependencies are marked optional in the engine's `package.json` for the same reason — install them only when you wire this renderer up.

The renderer mounts a single `<GLView>`. On `onContextCreate` it builds an `expo-three` `Renderer`, a `THREE.Scene`, and a default `PerspectiveCamera(60, w/h, 0.1, 1000)` at `(0, 0, 5)` looking at the origin. From then on, a plain `requestAnimationFrame` loop on the **JS thread** reads the ECS component buffers each frame and reconciles `THREE.Mesh` / `THREE.Light` / camera state.

Why JS-thread, not UI-thread: the `expo-gl` context lives on the JS thread, so the Reanimated UI-thread snapshot trick the Skia renderer uses doesn't apply — and isn't needed. The simulation already runs on the JS thread, so the renderer reads the ECS TypedArrays directly with no cloning, no per-frame `ArrayBuffer` allocation.

---

## `<ThreeRenderer>` props

```ts
interface ThreeRendererProps {
  readonly world: World;
  readonly transform: Transform3DComponent;
  readonly mesh?: MeshComponent;
  readonly meshes?: ReadonlyArray<MeshDef>;
  readonly camera?: CameraComponent;
  readonly ambientLight?: AmbientLightComponent;
  readonly directionalLight?: DirectionalLightComponent;
  readonly pointLight?: PointLightComponent;
  readonly setupScene?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  readonly clearColor?: number | string;
}
```

`world` and `transform` are the only required props. Any of the rendering passes (meshes, camera, lights) is skipped if its corresponding component handle isn't supplied — start with just meshes, add lights and a camera when you need them.

### `world`

The same [`World`](./api-core.md#worlds) you pass to `<GameEngine>`.

### `transform`

A component with this exact schema:

```ts
type Transform3DComponent = Component<{
  x: 'f32'; y: 'f32'; z: 'f32';
  rx: 'f32'; ry: 'f32'; rz: 'f32';
  sx: 'f32'; sy: 'f32'; sz: 'f32';
}>;
```

Every renderable entity (mesh, camera, directional/point light) reads its world-space pose from this component. Rotation is XYZ Euler in radians.

### `mesh` + `meshes`

```ts
type MeshComponent = Component<{ mesh: 'u32' }>;

interface MeshDef {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material | THREE.Material[];
}
```

`mesh.mesh[id]` is an index into the `meshes` array — `meshes[idx].geometry` and `.material` are passed to `THREE.Mesh` lazily the first time an entity is seen. Consumers pre-build geometries and materials at scene-load time, just like Skia atlases.

If `mesh` or `meshes` is omitted, the mesh pass is skipped entirely. Useful for scenes that only project lights at procedurally drawn content from `setupScene`.

### `camera`

```ts
type CameraComponent = Component<{
  fov: 'f32';     // degrees
  near: 'f32';
  far: 'f32';
  active: 'u8';   // 0 = inactive, 1 = active
}>;
```

The first alive entity carrying both `transform` and `camera` with `active === 1` becomes the rendering camera each frame. Position and rotation are read from `transform` (XYZ Euler, default forward is `-Z`). `fov` / `near` / `far` are diffed against the live `THREE.PerspectiveCamera`; the projection matrix is rebuilt only when one of them changes.

If no entity matches, the default camera (configured by `setupScene` or the `(0, 0, 5)` factory default) is used unchanged. So the camera prop is fully optional — leave it off and the renderer behaves like slice 1.

### `ambientLight`

```ts
type AmbientLightComponent = Component<{
  color: 'u32';     // 0xRRGGBB
  intensity: 'f32';
}>;
```

Ambient light has no position, so it does **not** require `transform`. Each entity with this component becomes a `THREE.AmbientLight` added to the scene. Color and intensity are synced each frame; removing the component (or destroying the entity) detaches the light.

### `directionalLight`

```ts
type DirectionalLightComponent = Component<{
  color: 'u32';
  intensity: 'f32';
}>;
```

Each entity with both `transform` and `directionalLight` becomes a `THREE.DirectionalLight`. Position is read from `transform`; the light's target stays at the scene origin (the three.js default). To aim the light somewhere else, override `light.target` from a `setupScene` callback — the renderer doesn't currently expose a target component.

### `pointLight`

```ts
type PointLightComponent = Component<{
  color: 'u32';
  intensity: 'f32';
  distance: 'f32';   // 0 = infinite range
  decay: 'f32';      // physically correct = 2
}>;
```

Each entity with both `transform` and `pointLight` becomes a `THREE.PointLight` at the transform's position.

### `setupScene`

```ts
(scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void
```

Called once after the GL context is created, before the render loop starts. Use it to attach static decoration that doesn't need to be ECS-driven (skybox, env maps, fog, helpers, a fixed studio light rig, custom default camera position).

If you also drive the camera through ECS, the `setupScene` configuration is the fallback used until an active camera entity exists.

### `clearColor`

The GL clear color, as a CSS-color string or a `0xRRGGBB` number. Defaults to `0x000000`.

---

## What the renderer does each frame

1. **Camera reconciliation.** Scan for the first alive entity with `transform.bit | camera.bit` and `active === 1`; copy position / rotation / fov / near / far onto the live `PerspectiveCamera`. Skipped if no `camera` prop.
2. **Mesh reconciliation.** For each entity matching `transform.bit | mesh.bit`: lazily create a `THREE.Mesh(geometry, material)` from `meshes[idx]`, sync its transform, sweep meshes whose entities are gone or no longer match.
3. **Light reconciliation.** Same pattern, repeated for ambient (no transform), directional, and point lights.
4. **`renderer.render(scene, camera)` + `gl.endFrameEXP()`.**

Everything in this loop is allocation-free in steady state once each entity has been registered. The first time an entity appears the renderer allocates one `THREE.Mesh` / `THREE.Light` and records it in a `Map<EntityId, ...>`; subsequent frames reuse those instances and just write new `position` / `rotation` / `intensity` / `color` values.

---

## Mounting it

```tsx
<GameEngine world={scene.world} systems={scene.systems}>
  {/* renderer is passed as a prop on `<GameEngine>`, not as a child */}
</GameEngine>
```

Use the renderer prop:

```tsx
<GameEngine
  world={scene.world}
  systems={scene.systems}
  renderer={
    <ThreeRenderer
      world={scene.world}
      transform={scene.transform}
      mesh={scene.mesh}
      meshes={scene.meshes}
      camera={scene.camera}
      ambientLight={scene.ambientLight}
      directionalLight={scene.directionalLight}
      clearColor={0x111111}
    />
  }
/>
```

For a complete runnable scene see [`example-3d/`](https://github.com/onlynative/game-engine/tree/main/example-3d) in the repo.

---

## Loading glTF models

```ts
import {
  loadGltf,
  useGltf,
  extractMeshDefs,
} from '@onlynative/game-engine/renderers/three';

function loadGltf(source: AssetSource): Promise<GLTF>;
function useGltf(source: AssetSource): GLTF;
function extractMeshDefs(gltf: GLTF): MeshDef[];
```

`loadGltf` bridges the engine [asset pipeline](./api-assets.md) to three.js's `GLTFLoader`: it resolves `source` (bundled `require(...)` or remote URL), reads the file's bytes via `expo-file-system`, and hands them to `loader.parse()`. Per-source dedupe — multiple calls share one in-flight promise, so `useGltf` is React 19 `use()`-compatible and safe to call from a `<Suspense>` boundary.

```tsx
function GameView() {
  const gltf = useGltf('https://example.com/character.glb');
  const scene = useMemo(() => loadScene(gltf), [gltf]);
  return <GameEngine world={scene.world} systems={scene.systems} renderer={...} />;
}

<Suspense fallback={null}>
  <GameView />
</Suspense>
```

`extractMeshDefs(gltf)` flattens the parsed scene into `MeshDef[]` ready for the renderer's `meshes` prop — depth-first traversal collects every `THREE.Mesh` it encounters and copies its `geometry` / `material`. Useful when you want to drive glTF-sourced meshes through the ECS:

```ts
const meshes = [
  { geometry: new THREE.BoxGeometry(1, 1, 1), material: standardMat },
  ...extractMeshDefs(gltf),
];
addComponent(world, entity, mesh, { mesh: 1 }); // first glTF mesh
```

> `extractMeshDefs` **drops world-space transforms.** Only `geometry` and `material` survive; the original glTF node hierarchy is gone. If you need that hierarchy preserved, attach `gltf.scene` directly via `setupScene` instead of routing through the ECS.

### Limitations

- **`.glb` only.** A `.gltf` file that references external `.bin` / image resources won't resolve them — the loader's resource manager isn't wired through the asset pipeline. Convert to `.glb` (single-file binary) at export time.
- **Embedded textures inside `.glb` may not decode in all React Native environments.** Three.js's image decoding goes through the global `Image` constructor, which Expo Go polyfills but doesn't guarantee for every codec. Plain-geometry / vertex-color models are the safest path; verify on device for textured assets.
- **No animation / skeleton helpers.** The parsed `GLTF.animations` / `GLTF.scene.animations` are passed through unchanged, but there's no engine-level integration with `THREE.AnimationMixer` yet — drive it manually if you need it.

---

## Limitations / roadmap

- **No camera target component.** Directional lights default-target the origin; `PerspectiveCamera` is oriented purely from Euler rotation. There's no `LookAt` component yet — animate `transform.r{x,y,z}` to point things, or grab the camera ref via `setupScene`.
- **`Map<EntityId, _>` iterators allocate.** The dead-entry sweep at the end of each pass uses `Map.forEach`, which allocates an iterator per pass. Negligible at prototype counts; switch to parallel arrays if profiling says it matters.
- **`mesh` index changes reassign `obj.geometry` / `obj.material`.** Three.js GC behavior on rapid swaps isn't fully verified — treat the mesh index as effectively static per entity for now.
- **Single active camera.** The first entity with `active === 1` wins; there's no view-stacking, picture-in-picture, or split-screen support.
