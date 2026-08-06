# Physics

```ts
import { createPhysics } from '@rootnative/game-engine';
import type {
  Physics,
  PhysicsOptions,
  BodyDef,
  BodyShape,
  BodyComponent,
  Position2D,
  Velocity2D,
} from '@rootnative/game-engine';
```

A custom **circles + axis-aligned-box** solver built directly on the ECS TypedArrays. Roughly 250 lines, allocation-free in the hot loop, ~5–10× faster than a JS Box2D port for circle-stacking workloads.

**What it does:** position-separation, restitution impulse, Coulomb friction. Single-pass resolution per contact.

**What it doesn't do:** rotational dynamics, joints, polygons, continuous collision detection. If your game needs any of these, the `Physics` interface is small enough to back with planck behind the same shape.

---

## `createPhysics(options)`

```ts
function createPhysics(options: PhysicsOptions): Physics;

interface PhysicsOptions {
  readonly world: World;
  readonly position: Position2D;            // Component<{ x: 'f32'; y: 'f32' }>
  readonly velocity: Velocity2D;            // Component<{ x: 'f32'; y: 'f32' }>
  readonly gravity?: { readonly x: number; readonly y: number };  // default { x: 0, y: 600 }
}
```

Defines a `Body` component on the world (so this counts toward the 32-component limit) and returns a `Physics` instance you wire into the system list.

```ts
const Position = defineComponent(world, { x: 'f32', y: 'f32' });
const Velocity = defineComponent(world, { x: 'f32', y: 'f32' });

const physics = createPhysics({
  world,
  position: Position,
  velocity: Velocity,
  gravity: { x: 0, y: 600 }, // px/s² downward
});

const systems = [physics.step];
```

- Gravity defaults to `(0, 600)` px/s². Pass `{ x: 0, y: 0 }` to disable.
- All values are in **pixels and seconds**. No meters/PPM conversion.

---

## `Physics`

```ts
interface Physics {
  readonly body: BodyComponent;
  readonly attach: (id: EntityId, def: BodyDef) => void;
  readonly detach: (id: EntityId) => void;
  readonly step: System;
  readonly destroy: () => void;
}
```

### `body`

The `Body` component this physics instance defined. Useful if you need to query against it directly (`hasComponent(world, id, physics.body)`).

```ts
type BodyComponent = Component<{
  type: 'u8';      // 0 = static, 1 = dynamic
  shape: 'u8';     // 0 = circle, 1 = box
  halfW: 'f32';
  halfH: 'f32';    // equals halfW for circles
  invMass: 'f32';  // 0 for static
  rest: 'f32';     // restitution
  fric: 'f32';     // friction
}>;
```

### `attach(id, def)`

Adds `Position`, `Velocity`, and `Body` components to `id` and writes the body's static row.

```ts
physics.attach(id, {
  type: 'dynamic',
  position: { x: 100, y: 50 },
  velocity: { x: 0, y: 0 },     // optional, defaults to zero
  shape: { kind: 'circle', radius: 8 },
  // mass:        derived from area if omitted
  // friction:    0
  // restitution: 0
});
```

If the entity already had any of these components, the row is overwritten.

### `detach(id)`

Removes the `Body` component from `id`. `Position` and `Velocity` are left in place — other systems often still need them.

```ts
physics.detach(id);
```

You don't have to `detach` before `destroyEntity`. `destroyEntity` zeroes the entity's whole component mask, which clears the `Body` bit along with everything else, so `step` stops picking the entity up on its next scan. The row's old bytes stay in the buffers until a later `attach` overwrites them — harmless, since nothing reads a row whose bit is clear.

### `step`

The `System` you put in your system list. Runs one fixed timestep per call:

1. Rebuild the dynamic / static work lists by scanning `[0, world.nextId)`. Dead entities and entities missing the required components are skipped, so destroyed bodies drop out here without any explicit cleanup.
2. Integrate dynamic bodies (gravity + velocity → position).
3. Test dynamic-vs-static pairs.
4. Test dynamic-vs-dynamic pairs (O(N²) broadphase).

Each overlapping pair is resolved inline as it's found — positional separation by inverse-mass ratio, then restitution impulse, then Coulomb friction (clamped to `μ * j_normal`). There's no separate contact-resolution phase and no contact list; resolution happens inside the pair test.

Cost is dominated by the O(N²) pair loop. Comfortable up to ~200 dynamic bodies. Replace with a uniform spatial hash before pushing past that — the `step` interface stays the same.

### `destroy()`

Clears the internal work lists. Call from a cleanup path if you're tearing down the world; not required for normal use.

---

## `BodyDef`

```ts
interface BodyDef {
  readonly type: 'static' | 'dynamic';
  readonly position: { readonly x: number; readonly y: number };
  readonly velocity?: { readonly x: number; readonly y: number };
  readonly shape: BodyShape;
  readonly mass?: number;          // dynamic only
  readonly friction?: number;      // 0..1, default 0
  readonly restitution?: number;   // 0..1, default 0 (1 = perfectly elastic)
}
```

### `type: 'static' | 'dynamic'`

- **`static`** — never integrated, infinite mass (`invMass = 0`). Walls, floors, immovable platforms.
- **`dynamic`** — integrated each step, finite mass.

Static-vs-static pairs are skipped. Dynamic bodies do not collide with the screen edges by default — add static AABBs as walls.

### `mass`

Dynamic bodies derive mass from area when omitted:

- Circle: `π * r²`
- Box: `width * height`

Pass `mass` explicitly to override (heavier bodies push lighter ones around). Static bodies ignore `mass`.

### `friction` and `restitution`

Pair-wise rules per contact:

- **Friction** is averaged across the two bodies (`μ = (a.fric + b.fric) / 2`).
- **Restitution** uses the minimum of the two bodies (`e = min(a.rest, b.rest)`). A perfectly bouncy ball on a non-bouncy floor will not bounce.

Both default to `0`.

---

## `BodyShape`

```ts
type BodyShape =
  | { readonly kind: 'circle'; readonly radius: number }
  | { readonly kind: 'box';    readonly width: number; readonly height: number };
```

Boxes are **axis-aligned**. There's no rotation in the solver — a sprite that visually rotates while its body stays AABB is fine, but the physics shape will not match the visual.

Pair handlers:

| A vs B | Handler |
| --- | --- |
| circle, circle | `collideCircleCircle` |
| circle, box | `collideCircleBox` |
| box, circle | `collideCircleBox` (swapped) |
| box, box | `collideBoxBox` |

---

## Type aliases

```ts
type Position2D = Component<{ x: 'f32'; y: 'f32' }>;
type Velocity2D = Component<{ x: 'f32'; y: 'f32' }>;
```

Re-exported so you can type your own components if you build them outside the call to `defineComponent` (e.g., for sharing across modules).

---

## Caveats

- **Imperative attach / detach.** Bodies aren't yet declarative — you can't `addComponent(world, id, physics.body, {...})` and have it Just Work, because `attach` does extra bookkeeping (deriving `invMass` from area, packing shape into `halfW`/`halfH`). A declarative `PhysicsBody` component is on the roadmap.
- **No CCD.** A small fast-moving body can tunnel through a thin static. Either bump the body's radius / box size, or use multiple thinner walls.
- **No sleeping bodies.** Every dynamic is integrated and pair-tested every step. With 200 dynamic bodies this is still well within frame budget on mid-tier devices.
