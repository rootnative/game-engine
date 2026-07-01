# Documentation

API reference and concept docs for `@rootnative/game-engine`.

For install + a runnable minimal example, see the [repo root README](../README.md).

## Concepts

- [Architecture](./concepts.md) — the two-loop split, ECS rationale, fixed timestep, why no React per frame.

## API reference

- [Core](./api-core.md) — `createWorld`, `defineComponent`, entity lifecycle, `query`, `createLoop`, `System`, `FrameContext`.
- [`<GameEngine>`](./api-game-engine.md) — mount component, `useEngine`.
- [Physics](./api-physics.md) — `createPhysics`, `BodyDef`, body shapes.
- [Assets](./api-assets.md) — `loadAsset`, `useAsset`, `clearAssetCache`.
- [Skia renderer](./api-renderer-skia.md) — `<SkiaRenderer>`, `SkiaAtlas`, `loadSkiaAtlas`, `gridFrames`.
- [Three.js renderer](./api-renderer-three.md) — `<ThreeRenderer>`, `MeshDef`, ECS-driven `Camera` / `AmbientLight` / `DirectionalLight` / `PointLight` components, `loadGltf` / `useGltf` / `extractMeshDefs`.

## Subpath imports

| Import | Module |
| --- | --- |
| `@rootnative/game-engine` | ECS, world, loop, `<GameEngine>`, physics, asset loader |
| `@rootnative/game-engine/renderers/skia` | `<SkiaRenderer>`, `SkiaAtlas`, `loadSkiaAtlas`, `gridFrames` |
| `@rootnative/game-engine/renderers/three` | `<ThreeRenderer>`, `MeshDef`, 3D ECS components |
