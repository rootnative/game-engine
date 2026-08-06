# Core API

```ts
import {
  createWorld,
  defineComponent,
  createEntity,
  destroyEntity,
  addComponent,
  removeComponent,
  hasComponent,
  query,
  createLoop,
} from '@rootnative/game-engine';
```

Everything here is renderer-agnostic. The same imports work whether you render with Skia today or `expo-gl` + three.js later.

---

## Worlds

### `createWorld(options)`

```ts
function createWorld(options: { capacity: number }): World;
```

Allocates a world with a fixed entity capacity. All component buffers in this world will be sized to `capacity`.

```ts
const world = createWorld({ capacity: 1024 });
```

- **`capacity`** must be a positive integer. Throws otherwise.
- Pick a capacity that fits the largest level. Entities recycle through a free list, so you only need to size for the peak count of simultaneously-alive entities.

### Entity lifecycle

```ts
function createEntity(world: World): EntityId;
function destroyEntity(world: World, id: EntityId): void;
```

`createEntity` returns the next free integer id (popped from the free list when available, otherwise a fresh id). Throws if `world.nextId` reaches `capacity` and the free list is empty.

`destroyEntity` clears the entity's component mask and pushes its slot onto the free list. Calling it on a destroyed or never-allocated id is a no-op.

```ts
const id = createEntity(world);
// ...
destroyEntity(world, id);
```

### `World` shape

```ts
interface World {
  readonly capacity: number;
  readonly components: Component[];
  readonly alive: Uint8Array;       // 1 = alive, 0 = dead
  readonly mask: Uint32Array;       // component bitmask per entity
  readonly freeList: Uint32Array;
  freeCount: number;
  nextId: EntityId;                 // high-water mark
}
```

You rarely touch `World` fields directly. Renderers and physics step internally iterate `[0, world.nextId)`, gating on `alive[id] === 1` and the component mask.

---

## Components

### `defineComponent(world, schema)`

```ts
type FieldType = 'f32' | 'f64' | 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32';

function defineComponent<S extends Record<string, FieldType>>(
  world: World,
  schema: S,
): Component<S>;
```

Declares a component on a world. Allocates one TypedArray per field, sized to `world.capacity`, and assigns the next free bit (0..31) to the component.

```ts
const Position = defineComponent(world, { x: 'f32', y: 'f32' });
const Velocity = defineComponent(world, { x: 'f32', y: 'f32' });
const Sprite   = defineComponent(world, { atlas: 'u32', frame: 'u16', tint: 'u32' });

Position.data.x[id]; // Float32Array
Position.data.y[id]; // Float32Array
Sprite.data.atlas[id]; // Uint32Array
```

- **Maximum 32 components per world.** Throws if you exceed it.
- The order in which you call `defineComponent` determines the bit each component gets, which determines the order they're stored in `world.components`.
- The schema flows into `Component<S>['data']`, so reading `Position.data.x` gives you a typed `Float32Array`.

### `Component<S>` shape

```ts
interface Component<S extends ComponentSchema> {
  readonly id: number;            // index into world.components
  readonly bit: number;           // 1 << id
  readonly schema: S;
  readonly data: { readonly [K in keyof S]: TypedArrayFor<S[K]> };
}
```

### `addComponent(world, id, component, values?)`

```ts
function addComponent<S>(
  world: World,
  id: EntityId,
  component: Component<S>,
  values?: Partial<{ readonly [K in keyof S]: number }>,
): void;
```

Sets the component's bit on `world.mask[id]` and writes initial values into the component's TypedArrays. Missing fields default to `0`.

```ts
addComponent(world, id, Position, { x: 100, y: 50 });
addComponent(world, id, Velocity);                    // x = 0, y = 0
```

Calling `addComponent` again for the same entity overwrites the row.

### `removeComponent(world, id, component)` / `hasComponent(world, id, component)`

```ts
function removeComponent(world: World, id: EntityId, component: Component): void;
function hasComponent(world: World, id: EntityId, component: Component): boolean;
```

O(1) bitmask ops. `removeComponent` does **not** zero the component's data — the row will be reused if the component is re-added.

---

## Queries

### `query(world, ...components)`

```ts
function query(world: World, ...components: Component[]): Query;

interface Query {
  each(fn: (id: EntityId) => void): void;
}
```

Builds a mask from the listed components, then scans `[0, world.nextId)` and invokes `fn(id)` for every alive entity whose mask matches all of them.

```ts
const movement: System = (world, ctx) => {
  const dt = ctx.time.delta;
  query(world, Position, Velocity).each((id) => {
    Position.data.x[id] += Velocity.data.x[id] * dt;
    Position.data.y[id] += Velocity.data.y[id] * dt;
  });
};
```

The callback only receives the id. You read and write through the components' typed buffers — no per-entity object allocation, no archetype lookup.

### Query performance

- **Cost is O(world.nextId)** per `each` call. The mask check is two ANDs and a compare.
- Calling `query()` itself is essentially free (just OR-ing bits).
- A typical system iterates two or three queries per tick. Hoisting buffer references to locals (`const px = Position.data.x;`) above the `each` is a small but real speedup.

---

## Systems

```ts
type System = (world: World, ctx: FrameContext) => void;
```

A system is a plain function. The simulation loop calls every system in order, once per fixed timestep, with the current world and frame context. No return value — systems mutate buffers in place.

Conventions:

- **Run on the JS thread.** Systems can use any JS — third-party libs (`planck`, custom solvers, AI) all live here.
- **Allocation-free in the hot path.** Pre-allocate vectors, pool entities, hoist buffer references.
- **No `runOnJS` / `runOnUI` per frame.** The render side picks up state through shared buffers; you don't need to bridge.

---

## Frame context

```ts
interface FrameContext {
  readonly time: {
    readonly current: number;     // sim seconds since loop.start()
    readonly previous: number;    // value of `current` last tick
    readonly delta: number;       // fixed step in seconds (e.g. 1/60)
    readonly alpha: number;       // reserved for interpolation; always 1 today
  };
  readonly input: {
    readonly touches: ReadonlyArray<TouchEvent>;
    readonly pointers: ReadonlyArray<Pointer>;
  };
  readonly screen: { readonly width: number; readonly height: number };
  readonly events: ReadonlyArray<GameEvent>;
  readonly dispatch: (e: GameEvent) => void;
}
```

- **`time.delta`** is the fixed step (default `1/60`s). Use it to integrate velocities — it does **not** change frame to frame.
- **`time.alpha`** is **reserved and not yet computed** — the loop initializes it to `1` and never updates it. It is intended as the fixed-timestep interpolation factor for renderers, but no renderer reads it today and neither the Skia nor the three renderer interpolates between sim states. Don't build on it yet.
- **`input.touches`** is drained at the end of every step. Read events early in your system list.
- **`input.pointers`** is **reserved and always empty** — nothing populates it. Use `input.touches` for input today.
- **`screen`** is set from the `<GameEngine>` view's `onLayout`.
- **`dispatch(event)`** queues a `GameEvent` for the *current* tick. `events` is drained at end of step.

### Touch events

```ts
interface TouchEvent {
  readonly id: number;            // pointer id (currently always 0)
  readonly type: 'start' | 'end' | 'move' | 'tap' | 'long-press';
  readonly x: number;
  readonly y: number;
  readonly dx?: number;           // present on 'move'
  readonly dy?: number;
  readonly t: number;             // wall-clock ms
}
```

Sourced from Gesture Handler's modern `Gesture.Pan` / `Gesture.Tap` / `Gesture.LongPress`. Multi-touch is not yet wired — `id` is hardcoded to `0`.

---

## Loop

You usually don't construct the loop yourself — `<GameEngine>` does it for you. Use `createLoop` directly only when embedding the engine without the React mount.

### `createLoop(world, systems, options?)`

```ts
function createLoop(
  world: World,
  systems: ReadonlyArray<System>,
  options?: { hz?: number; maxCatchUpMs?: number },
): Loop;
```

- **`hz`** — fixed-timestep rate. Default `60`.
- **`maxCatchUpMs`** — wall-delta clamp. If the measured wall-clock delta exceeds this (e.g. app backgrounded), the loop substitutes one step's worth of time instead, so a long freeze can't trigger a runaway catch-up burst. Default `250`ms. Note this clamps the *incoming* delta only — any time already in the accumulator still applies, so the tick may still run more than one step.

### `Loop` shape

```ts
interface Loop {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  isRunning(): boolean;
  isPaused(): boolean;
  swap(world: World, systems: ReadonlyArray<System>): void;
  setScreen(width: number, height: number): void;
  dispatch(e: GameEvent): void;
  pushTouch(e: TouchEvent): void;
  onAfterStep(cb: () => void): () => void;
}
```

- **`start` / `stop` / `pause` / `resume`** — self-explanatory. `stop` clears any pending tick.
- **`swap(world, systems)`** — atomically replaces both. Used for level transitions; the next tick runs against the new world. The accumulator and pending events/touches are cleared.
- **`setScreen(w, h)`** — write into `ctx.screen`.
- **`dispatch(e)`** — same as `ctx.dispatch` but callable from outside a system.
- **`pushTouch(e)`** — enqueue a touch event for the next tick. `<GameEngine>` calls this from gesture worklets via `runOnJS`.
- **`onAfterStep(cb)`** — register a callback that runs **once per frame** that produced at least one step (not once per step). Returns an unsubscribe function. Renderers use this to grab a snapshot of the world after the sim has settled.

### Timing model

The loop runs a `setTimeout`-driven accumulator on the JS thread:

1. On each tick, compute `wallDelta = now() - lastWall`.
2. If `wallDelta > maxCatchUpMs`, substitute one step's worth of time (avoid runaway catch-up after a freeze).
3. Add to accumulator. While `acc >= stepMs`, call `step()` and subtract.
4. After all steps for this tick, fire `onAfterStep` callbacks **once** (not per step).
5. Schedule the next tick to land at the next step boundary.

`time.delta` is always the fixed step in seconds — never the wall delta — so physics integration is stable regardless of frame-time jitter.
