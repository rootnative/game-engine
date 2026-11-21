# Changelog

All notable changes to `@rootnative/game-engine` are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow modified semver: a breaking change bumps the middle digit (`0.1.0`), and fixes and additions bump the last digit (`0.0.2`).

## [Unreleased]

## [0.0.0-alpha.1] - 2026-10-14

The first release. A 2D and 3D game engine for React Native that runs inside Expo Go, with no custom native code, no `expo prebuild`, and no config plugins. The engine core does not know about the renderer, and each renderer is a separate subpath export.

### Added

- **ECS core.** Entity ids are integers. Component data is in TypedArray buffers, and a query scans a bitmask. `createWorld`, `defineComponent`, `createEntity`, `destroyEntity`, `addComponent`, `removeComponent`, `hasComponent`, and `query`. A destroyed entity id goes back to a free list for reuse.
- **Fixed-timestep loop.** `createLoop` runs the simulation on the JS thread at 60 Hz by default (`hz`). An accumulator keeps the step fixed, and `maxCatchUpMs` (250 ms by default) limits the catch-up after a long frame.
- **`<GameEngine>` and `useEngine`.** The component starts the loop, and it gives the layout size to the systems as `ctx.screen`. It reads `hz` (60 by default) only at mount, and warns in development when `hz` changes later. The `world` and `systems` props accept a value or a `Promise`. A `Promise` suspends the nearest `<Suspense>` boundary, so a level can load asynchronously. Inside it, `useEngine()` gives a component the controls that the props don't own: `pause`, `resume`, `isPaused`, `isRunning`, `dispatch`, and `onAfterStep`.
- **Touch input.** `<GameEngine>` composes the pan, tap, and long-press gestures of React Native Gesture Handler on the UI thread. Each event goes into `ctx.input.touches`, and the loop empties that queue after each step. A touch sends `start` and `end`, with `move` events with `dx` and `dy` between them while the finger moves. Each `start` gets an `end`, also for a tap. `ctx.input.pointers` holds the state of the pointer: its position and whether it is down.
- **Physics.** `createPhysics({ world, position, velocity, gravity })` returns `attach`, `detach`, `step`, and `destroy`. The solver supports circles and axis-aligned boxes, with gravity, restitution, and Coulomb friction. All units are pixels, and gravity is 600 px/s² by default. Position and velocity are your own ECS components, so there is no second copy of the state. The next `step` removes the body of an entity that you destroy without `detach`.
- **Asset loader.** `loadAsset`, `useAsset`, and `clearAssetCache`. A source is a bundled asset (`require`) or a URL. The loader downloads a URL one time and caches the file on disk. All calls for one source share one `Promise`, so `useAsset` works with React 19 `use()`. A load that fails leaves the cache, so the next call for the source loads again. `loadGltf` follows the same rule.
- **Skia renderer**, at `@rootnative/game-engine/renderers/skia`. `<SkiaRenderer>` draws all sprites into one `<Canvas>` from a worklet on the UI thread, with one `drawAtlas` call for each atlas. React does not render once per frame. The `tint` field of a sprite is a packed `0xRRGGBBAA` color that multiplies the sprite, and `0` means no tint. `loadSkiaImage`, `loadSkiaAtlas`, and `gridFrames` build atlases and cut a sprite sheet into frames.
- **Three.js renderer**, at `@rootnative/game-engine/renderers/three`. `<ThreeRenderer>` uses `expo-gl` and `expo-three`. ECS components control the meshes (`MeshDef`), the camera, and ambient, directional, and point lights. `loadGltf`, `useGltf`, and `extractMeshDefs` load a `.glb` model through the asset loader.
- **Workaround for `expo-gl` before 58.0.4 and three r163+.** `expo-gl` before 58.0.4 makes a WebGL 2 context an instance of `WebGLRenderingContext`, and three r163 and later refuse such a context as WebGL 1. The fix in 58.0.4 is native, and the Expo Go builds for SDK 58 still have the bug. `<ThreeRenderer>` hides the global `WebGLRenderingContext` for the constructor call and restores it after. See [expo/expo#51543](https://github.com/expo/expo/issues/51543).
- **Optional renderer peers.** `@shopify/react-native-skia`, `expo-gl`, `expo-three`, and `three` are optional peer dependencies. Install only the renderer that you use.
- **Expo SDK 58 peer ranges.** React 19.3, React Native 0.88, Reanimated 4.7, Worklets 0.13, Gesture Handler 3, Skia 2.14, and `expo-asset`, `expo-file-system`, and `expo-gl` 58. npm refuses an install on a different SDK, and pnpm and yarn show a peer warning.
- **Documentation for AI agents.** The package ships `docs/`, `llms.txt`, and `llms-full.txt`. After an install, `node_modules/@rootnative/game-engine/llms.txt` is the exact API of that version.

### Known limitations

- **Input is single-touch.** Every touch has the pointer id `0`.
- **No interpolation.** The renderers draw the latest simulation state. They don't blend between the two most recent states.
- **The physics broadphase is O(N²).** It is satisfactory up to approximately 200 dynamic bodies.
- **The physics has no rotation, no joints, and no polygons.**
- **`attach` and `detach` are imperative.** There is no declarative physics body component.
- **The Skia renderer has no rotation and no per-entity scale.** It draws each sprite at the size of its atlas frame.
- **The renderers take their components as props with fixed schemas.** A renderer cannot yet declare which components it reads.
- **The 3D renderer loads `.glb` only.** A `.gltf` file with external resources does not load. There is no `LookAt` component, only one camera can be active, and there is no animation or skinning support.
- **The remote asset cache uses the URL as the key, not the content.** If a URL can serve different bytes, put a version in the URL or call `clearAssetCache()`.
- **No WebAssembly.** Expo Go runs Hermes, which does not support WebAssembly. So physics engines such as `rapier` and `box2d-wasm` cannot run.

[Unreleased]: https://github.com/rootnative/game-engine/compare/game-engine@0.0.0-alpha.1...HEAD
[0.0.0-alpha.1]: https://github.com/rootnative/game-engine/releases/tag/game-engine@0.0.0-alpha.1
