# Architecture

The engine is built around four ideas that follow from one constraint: **must run inside Expo Go on Hermes, hitting 60 FPS on mid-tier devices.** No native modules, no `expo prebuild`, no WebAssembly.

## 1. Two-loop split

The engine runs **two loops** that share state through Reanimated shared values, not events:

| Loop | Thread | Cadence | Job |
| --- | --- | --- | --- |
| **Simulation** | JS thread | Fixed timestep (default 60 Hz) | Run systems, mutate component buffers, step physics |
| **Render** | UI thread (Skia) / JS thread (three) | Snapshot per sim tick (Skia) / display rate (three) | Read component buffers, draw |

They never block each other. The render side reads the latest snapshot the sim has produced. If the JS thread hiccups, the Skia renderer's worklet keeps drawing the last snapshot on the UI thread; if rendering stalls, the sim still ticks at 60 Hz.

Two details where the implementation is narrower than the ideal:

- **No interpolation yet.** `ctx.time.alpha` is reserved for blending between the two most recent sim states, but it is always `1` and no renderer reads it. Rendering shows the latest sim state directly.
- **The three renderer runs on the JS thread**, not the UI thread — the `expo-gl` context lives there, so the worklet trick doesn't apply. It reads the ECS buffers directly, which costs nothing extra because the sim is on that thread anyway.

This decoupling is the point. A naive `requestAnimationFrame` + `setState` loop ties simulation and rendering to one thread (JS) and forces React to reconcile on every frame. That's the bottleneck the engine is shaped to avoid.

## 2. ECS with TypedArray-backed components

Entities are integer ids. Components are **schemas** bound to a world; the world allocates one TypedArray per field, sized to the world's capacity, and indexes by entity id.

```ts
const Position = defineComponent(world, { x: 'f32', y: 'f32' });
// Position.data.x[id], Position.data.y[id]
```

Why this shape:

- **Zero per-entity allocation in systems.** A movement system is a tight `for` loop over a TypedArray — no object property lookups, no garbage.
- **Cache-friendly iteration.** All `x` values live contiguously, all `y` values live contiguously.
- **Renderer iterates the same buffers.** No copy, no serialization between sim and render.
- **TypeScript stays the source of truth.** The schema's field types flow through to `Component<S>['data']`.

Trade-offs:

- **Maximum 32 components per world.** Component membership is a bit in a `Uint32Array` mask, one bit per component. Wide enough for any single game.
- **Capacity is fixed at world creation.** `createWorld({ capacity: 1024 })` allocates buffers up-front. Pick a capacity that fits the level; entities recycle through a free list.

## 3. Bitmask queries

`query(world, A, B).each(fn)` builds a mask of `A.bit | B.bit`, then scans `[0, world.nextId)` and calls `fn(id)` for every alive entity whose component mask matches.

```ts
const movement: System = (world, ctx) => {
  const dt = ctx.time.delta;
  const px = Position.data.x;
  const py = Position.data.y;
  const vx = Velocity.data.x;
  const vy = Velocity.data.y;
  query(world, Position, Velocity).each((id) => {
    px[id] += vx[id] * dt;
    py[id] += vy[id] * dt;
  });
};
```

Bitmask scans are O(N) over the world capacity per query. Archetype-based queries (one bucket per component combination) are a phase-1.5 optimization gated on profiling — the public API stays the same.

## 4. Renderer is pluggable

The engine core never imports Skia or three. A renderer is just a React component that reads component buffers and draws. How it does that is up to the renderer:

- [`<SkiaRenderer>`](./api-renderer-skia.md) subscribes via `loop.onAfterStep`, packs a snapshot into a `SharedValue`, and draws inside a UI-thread worklet.
- [`<ThreeRenderer>`](./api-renderer-three.md) runs a `requestAnimationFrame` loop on the JS thread and reads the ECS buffers directly — no snapshot, because it shares a thread with the sim.

Both ship today, under separate subpath imports (`/renderers/skia`, `/renderers/three`) so consumers only bundle the one they use. Switching renderers does not require changing systems, queries, or component layout.

## What lives where

```
src/
  core/         ECS, loop, types  ← renderer-agnostic
  GameEngine.tsx                   ← React mount + input plumbing
  physics/      Custom AABB + circles solver
  assets/       Bundled + remote asset loader (Suspense-friendly)
  renderers/
    skia/       Phase 1 renderer (2D)
    three/      Phase 2 renderer (3D) + glTF loader
```

## Performance rules the engine enforces

- **No React re-renders during gameplay.** HUD/menus use React state; gameplay does not.
- **No allocations in the hot loop.** Systems read and write into pre-allocated TypedArrays.
- **Sim and render share buffers.** No copying, no serialization.
- **Render-side code runs as worklets.** Sim runs on the JS thread. They communicate only through shared TypedArray buffers — never via per-frame `runOnJS` / `runOnUI` calls.

## Why not...

- **`requestAnimationFrame` + `setState`** — couples simulation and rendering to the JS thread; reconciles React per frame.
- **A React tree per entity** — reconciliation cost grows linearly with entity count.
- **Map of plain-object entities** — pointer chasing, GC churn, no chance of contiguous memory.
- **Box2D port (planck, matter.js)** — solver dominates frame time once ~80 dynamic circles stack at a wall. The custom solver does only what arcade games need (circles + AABBs, no rotation, no joints) and runs 5–10× faster on those workloads. WASM physics is ruled out by Hermes.
