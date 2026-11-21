# `<GameEngine>` and `useEngine`

```ts
import { GameEngine, useEngine } from '@rootnative/game-engine';
```

`<GameEngine>` is the React mount point for the engine. It owns the simulation [`Loop`](./api-core.md#loop), wires gesture-based input into the loop's touch queue, and propagates layout size into `ctx.screen`. The renderer is passed in as a child node so engine core stays renderer-agnostic.

---

## `<GameEngine>` props

```ts
interface GameEngineProps {
  readonly world: World | Promise<World>;
  readonly systems: ReadonlyArray<System> | Promise<ReadonlyArray<System>>;
  readonly renderer: ReactNode;
  readonly running?: boolean;          // default true
  readonly hz?: number;                // default 60
  readonly children?: ReactNode;       // HUD, menus, overlays
}
```

### `world`

The [world](./api-core.md#worlds) the loop drives. The loop is created once on mount; passing a new `world` reference triggers an internal `loop.swap(world, systems)` on the next render — the loop is **not** torn down and recreated.

May also be a `Promise<World>`. The component calls React 19's `use()` on it, suspending the nearest `<Suspense>` boundary until the promise settles. See [Suspense and async level loads](#suspense-and-async-level-loads).

### `systems`

The system list to run each fixed step, in order. Like `world`, replacing the array calls `loop.swap`. Also accepts a `Promise<ReadonlyArray<System>>` — typically derived from the same level-loader promise as `world`.

> Wrap `systems` in `useMemo` so identity is stable across renders. A fresh array reference every render does extra `swap` calls — harmless but wasteful. The same applies to promises: memoize the source promise so `use()` doesn't keep re-suspending.

### `renderer`

A `ReactNode` rendered inside the gesture detector. The engine ships [`<SkiaRenderer>`](./api-renderer-skia.md) for 2D and [`<ThreeRenderer>`](./api-renderer-three.md) for 3D. Anything that reads component buffers and draws is fair game.

```tsx
renderer={
  <SkiaRenderer
    world={world}
    position={Position}
    sprite={Sprite}
    atlases={atlases}
  />
}
```

### `running` (default `true`)

Controls the loop's start/stop. Toggling from `true` → `false` calls `loop.stop()`. The loop is also stopped on unmount.

> `running` is a pause-equivalent today. To pause without tearing down (preserving accumulator + handlers), call `useEngine().pause()` / `.resume()` instead.

### `hz` (default `60`)

Fixed-timestep rate in Hz. Passed straight to `createLoop`. **`<GameEngine>` reads `hz` only at mount.** A later change has no effect, and React Native prints a warning in development. To change the rate, remount `<GameEngine>`, for example with a new `key`. A remount starts a new loop: the sim time starts at 0, and the queued touches and events are gone.

### `children`

Rendered **above** `renderer` inside the same root view. Use this for HUD, menus, debug overlays — anything that uses normal React state.

```tsx
<GameEngine world={world} systems={systems} renderer={<SkiaRenderer .../>}>
  <HUD score={score} lives={lives} />
</GameEngine>
```

---

## `useEngine()`

```ts
function useEngine(): Engine;

interface Engine {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  isRunning(): boolean;
  dispatch(e: GameEvent): void;
  onAfterStep(cb: () => void): () => void;
}
```

Returns the controls of the loop of the nearest `<GameEngine>`. Throws if called outside one.

```tsx
function PauseButton() {
  const engine = useEngine();
  return (
    <Pressable onPress={() => (engine.isPaused() ? engine.resume() : engine.pause())}>
      <Text>{engine.isPaused() ? 'Resume' : 'Pause'}</Text>
    </Pressable>
  );
}
```

Common uses:

- **HUD pause / resume** — call `engine.pause()` / `engine.resume()`.
- **Events from the UI** — `engine.dispatch(event)` queues a `GameEvent` for the next step, the same as `ctx.dispatch` in a system.
- **Subscribing to step events** — `engine.onAfterStep(cb)` to drive a renderer or external sink. Always store and call the returned unsubscribe function in a `useEffect` cleanup.

The props of `<GameEngine>` control the rest of the loop, so `Engine` doesn't have it:

- **Start and stop** — set `running`.
- **Level transitions** — pass a new `world` and `systems`. With promises, see [Suspense and async level loads](#suspense-and-async-level-loads).
- **Screen size and touches** — `<GameEngine>` sets them from its layout and its gestures.

To drive a loop with no `<GameEngine>`, use [`createLoop`](./api-core.md#loop), which gives the full `Loop`.

---

## Suspense and async level loads

The `world` and `systems` props each accept a `Promise`. Inside `<GameEngine>` the component calls `use(world)` / `use(systems)` (React 19), so:

- The component **suspends** until both promises settle. Any ancestor `<Suspense fallback={...}>` shows its fallback.
- Once both resolve, the component renders normally and `loop.swap` runs with the resolved values — the same path a synchronous prop change takes.
- Wrap the swap in `useTransition` to keep the previous level on screen while the next one loads instead of falling back.

The recommended pattern: build one `Promise<{ world, systems }>` per level and derive the two prop promises from it with stable identity.

```tsx
import { Suspense, useMemo, useState, useTransition } from 'react';
import { GameEngine } from '@rootnative/game-engine';

interface Level {
  world: World;
  systems: ReadonlyArray<System>;
}

async function loadLevel(n: number): Promise<Level> {
  // build the world, attach physics bodies, decode any atlases the level needs, etc.
}

function Game({ levelNum }: { levelNum: number }) {
  const levelPromise = useMemo(() => loadLevel(levelNum), [levelNum]);
  const worldPromise = useMemo(() => levelPromise.then((l) => l.world), [levelPromise]);
  const systemsPromise = useMemo(() => levelPromise.then((l) => l.systems), [levelPromise]);

  return (
    <GameEngine
      world={worldPromise}
      systems={systemsPromise}
      renderer={<SkiaRenderer .../>}
    />
  );
}

function App() {
  const [n, setN] = useState(1);
  const [, startTransition] = useTransition();
  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        <Game levelNum={n} />
      </Suspense>
      <NextLevelButton onPress={() => startTransition(() => setN((m) => m + 1))} />
    </>
  );
}
```

Why memoize the derived promises: React's `use()` matches by promise identity. Re-deriving via `.then(...)` inside JSX would create a new promise every render and re-suspend forever.

Alternative pattern: skip the engine's promise support and call `use()` yourself at the parent. `<GameEngine>` accepts plain `World` / `ReadonlyArray<System>` too, so this path is just as legal — and avoids deriving two promises:

```tsx
function Game({ levelNum }: { levelNum: number }) {
  const levelPromise = useMemo(() => loadLevel(levelNum), [levelNum]);
  const { world, systems } = use(levelPromise);
  return <GameEngine world={world} systems={systems} renderer={<SkiaRenderer .../>} />;
}
```

The two patterns differ only in where suspension happens; the swap behavior is identical.

---

## Input pipeline

`<GameEngine>` wraps its content in a `<GestureDetector>` composed of three gestures from the Gesture Handler 3 hook API:

| Gesture | Emits |
| --- | --- |
| `usePanGesture` | `start` (on begin), `move` (on update, with `dx`/`dy`), `end` (on finalize) |
| `useTapGesture` | `tap` |
| `useLongPressGesture` | `long-press` |

All three run **simultaneously** (`useSimultaneousGestures`) on the UI thread. Each gesture callback is a worklet that calls `scheduleOnRN(loop.pushTouch, event)` to enqueue a [`TouchEvent`](./api-core.md#touch-events) for the next sim step.

The sim loop drains `ctx.input.touches` at the end of every step, so each event is visible to systems in exactly one tick.

The pan sends `end` from `onFinalize`, which runs after each gesture that began, also when the pan never activated. So each `start` gets an `end`, also for a tap or a touch that doesn't move. The loop keeps the pointer state from these events in [`ctx.input.pointers`](./api-core.md#pointers).

> Input is single-touch: each event has the pointer id `0`. The pan, tap and long-press gestures don't give an id for each finger.

---

## Layout

`<GameEngine>` renders a flexed root `<View>` (`flex: 1`) with `collapsable={false}` so Reanimated worklets keep a stable native handle. The view's `onLayout` writes into `ctx.screen` via `loop.setScreen(width, height)`.

If you mount `<GameEngine>` inside a non-flexed container, give it explicit width/height — otherwise `ctx.screen` will be `{ width: 0, height: 0 }`.

> **Wrap your app root with `GestureHandlerRootView`** at the top of your tree. This is a Gesture Handler requirement, not a `<GameEngine>` thing — without it, no gestures fire.

---

## Lifecycle

1. **Resolve.** If `world` or `systems` is a Promise, `<GameEngine>` calls `use()` on it and suspends until settled. Sync values pass through untouched.
2. **Mount.** Calls `createLoop(world, systems, { hz })` one time. The loop stays for the life of the component.
3. **First effect.** `loop.swap(world, systems)` is called once to bind the world and systems.
4. **Running effect.** If `running` is true, `loop.start()`. The cleanup runs `loop.stop()`.
5. **Re-render with new `world` or `systems`.** Triggers another `loop.swap`. The loop keeps running; the next tick uses the new state. With promises, this happens after the new promise resolves.
6. **Unmount.** `loop.stop()` runs from the `running` effect's cleanup. Pending timeouts are cleared.

The loop is **not** destroyed on `running={false}` — it's just stopped. If you want a hard reset, unmount `<GameEngine>` and remount with a new `world`.
