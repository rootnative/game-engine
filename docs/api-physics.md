# Physics

```ts
import { createPhysics } from '@rootnative/game-engine';
import type {
  Physics,
  PhysicsOptions,
  BodyDef,
  BodyShape,
  BodyComponent,
  Contacts,
  EndedContacts,
  Position2D,
  Velocity2D,
} from '@rootnative/game-engine';
```

A custom **circles + axis-aligned-box** solver built directly on the ECS TypedArrays. Allocation-free in the hot loop, and it does only what arcade games need.

**What it does:** position-separation, restitution impulse, Coulomb friction, contact records, sensors, collision layers. Single-pass resolution per contact.

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
  readonly maxContacts?: number;            // default 2 * world.capacity
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
- `maxContacts` is the number of records that [`contacts`](#contacts) can hold. It must be a positive integer.

---

## `Physics`

```ts
interface Physics {
  readonly body: BodyComponent;
  readonly attach: (id: EntityId, def: BodyDef) => void;
  readonly detach: (id: EntityId) => void;
  readonly step: System;
  readonly contacts: Contacts;
  readonly ended: EndedContacts;
  readonly destroy: () => void;
}
```

### `body`

The `Body` component this physics instance defined. Useful if you need to query against it directly (`hasComponent(world, id, physics.body)`).

```ts
type BodyComponent = Component<{
  type: 'u8';      // 0 = static, 1 = dynamic
  shape: 'u8';     // 0 = circle, 1 = box
  flags: 'u8';     // bit 0 = sensor
  halfW: 'f32';
  halfH: 'f32';    // equals halfW for circles
  invMass: 'f32';  // 0 for static
  rest: 'f32';     // restitution
  fric: 'f32';     // friction
  layer: 'u32';    // the layers that the body is on
  collides: 'u32'; // the layers that the body collides with
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
  // sensor:      false
  // layer:       1
  // collidesWith: 0xffffffff (each layer)
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

Each overlapping pair is resolved inline as it's found — positional separation by inverse-mass ratio, then restitution impulse, then Coulomb friction (clamped to `μ * j_normal`). There's no separate contact-resolution phase; resolution happens inside the pair test. Each pair also gets a record in [`contacts`](#contacts).

Cost is dominated by the O(N²) pair loop. Comfortable up to ~200 dynamic bodies.

### `contacts`

The pairs of bodies that touched in the last `step`. Read it in a system that runs after `physics.step`.

```ts
interface Contacts {
  readonly count: number;         // the number of records
  readonly dropped: number;       // the contacts that did not fit
  readonly a: Uint32Array;        // the lower entity id of the pair
  readonly b: Uint32Array;        // the higher entity id of the pair
  readonly nx: Float32Array;      // the normal, from a to b
  readonly ny: Float32Array;
  readonly depth: Float32Array;   // the overlap before the separation, in px
  readonly impulse: Float32Array; // the normal impulse
  readonly sensor: Uint8Array;    // 1 when a or b is a sensor
  readonly began: Uint8Array;     // 1 in the first step of the contact
}
```

Record `i` is the same index in each array. Only the indexes below `count` hold records.

```ts
const breakBricks: System = (world) => {
  const c = physics.contacts;
  for (let i = 0; i < c.count; i++) {
    if (c.began[i] === 0) continue;
    const other = c.a[i] === ballId ? c.b[i] : c.b[i] === ballId ? c.a[i] : -1;
    if (other >= 0 && hasComponent(world, other, Brick)) {
      destroyEntity(world, other);
    }
  }
};

const systems = [physics.step, breakBricks];
```

- **The records live for one step.** The next `step` starts with `count` at 0. Copy what you need to keep.
- **`a` is always the lower id.** So one pair has one form, and you check both `a` and `b` for your entity.
- **The normal is a unit vector from `a` to `b`.** With y down, `(0, 1)` means that `b` is below `a`.
- **`impulse` is the size of the hit**, in mass × px/s. It is `0` when the two bodies already move apart. Use it for the volume of a sound or for damage.
- **`began` is `1` only in the first step of a contact.** A pair that keeps its contact has a record in each step, with `began` at `0`. Use `began` for a thing that happens one time: a sound, a point, a hit.
- **An entity can be in more than one record.** If you destroy it in one record, check `hasComponent` before you use it in the next one.
- **A full buffer drops records, not physics.** The pair is still resolved, and `dropped` counts it. If `dropped` isn't 0, raise `maxContacts`. A dropped contact also has no begin and no end.

The arrays are allocated one time, in `createPhysics`. A step allocates nothing for them.

### `ended`

The pairs that had a record in the step before the last `step`, and have none now. Read it in the same system as `contacts`.

```ts
interface EndedContacts {
  readonly count: number;
  readonly a: Uint32Array; // the lower entity id of the pair
  readonly b: Uint32Array; // the higher entity id of the pair
}
```

```ts
const zones: System = () => {
  const c = physics.contacts;
  for (let i = 0; i < c.count; i++) {
    if (c.began[i] === 1 && (c.a[i] === zoneId || c.b[i] === zoneId)) enterZone();
  }
  const e = physics.ended;
  for (let i = 0; i < e.count; i++) {
    if (e.a[i] === zoneId || e.b[i] === zoneId) leaveZone();
  }
};
```

- **A pair is in the list for one step.**
- **A pair also ends when one of its bodies goes away**: after `destroyEntity`, after `detach`, or when the filter starts to reject the pair. So an id in the list can belong to a dead entity. Check `world.alive[id]` or `hasComponent` before you read its components.
- **A new `attach` starts the contacts of that id again.** In the next step, each of its old pairs is in `ended`, and each of its contacts has `began` at `1`. This keeps the data correct when a new entity gets the id of a destroyed one.
- **A sensor gets the same data.** `began` is "entered", and `ended` is "left".

### `destroy()`

Clears the internal work lists, the contact records, and the pairs that `began` and `ended` compare with. Call from a cleanup path if you're tearing down the world; not required for normal use.

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
  readonly sensor?: boolean;       // default false
  readonly layer?: number;         // bits, default 1
  readonly collidesWith?: number;  // bits, default 0xffffffff
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

### `sensor`

A sensor finds bodies and pushes nothing. Use it for a pickup, a goal, or a damage zone.

```ts
physics.attach(coinId, {
  type: 'static',
  position: { x: 200, y: 120 },
  shape: { kind: 'circle', radius: 12 },
  sensor: true,
});
```

- A pair with a sensor gets a record in [`contacts`](#contacts) with `sensor[i] === 1`, in each step that the overlap lasts. Its `impulse` is `0`.
- The solver does not move the two bodies and does not change their velocities.
- A dynamic sensor still falls with gravity and moves with its velocity.
- A static sensor finds only dynamic bodies, because static-vs-static pairs are skipped.

### `layer` and `collidesWith`

The filter sets which bodies meet. Each of the two values holds 32 bits, and one bit is one layer.

- `layer` is the set of layers that the body is on.
- `collidesWith` is the set of layers that the body accepts.

Two bodies meet only when each body accepts a layer of the other body:

```ts
(a.layer & b.collidesWith) !== 0 && (b.layer & a.collidesWith) !== 0
```

By default a body is on layer `1` and accepts each layer, so each body meets each other body.

```ts
const PLAYER = 1 << 0;
const ENEMY = 1 << 1;
const BULLET = 1 << 2;
const WALL = 1 << 3;

// A bullet of the player hits enemies and walls. It does not hit the
// player, and it does not hit other bullets.
physics.attach(bulletId, {
  type: 'dynamic',
  position: { x: 40, y: 300 },
  velocity: { x: 500, y: 0 },
  shape: { kind: 'circle', radius: 3 },
  layer: BULLET,
  collidesWith: ENEMY | WALL,
});
```

- A pair that the filter rejects gets no separation, no impulse, and no record in [`contacts`](#contacts).
- A sensor obeys the filter too.
- A body with `layer: 0` or `collidesWith: 0` meets nothing.
- The step checks the filter before the shape test, so a rejected pair costs almost nothing.
- While each body accepts each layer in use, as with the defaults, the step skips the filter check.

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

- **Imperative attach / detach.** Bodies aren't declarative — you can't `addComponent(world, id, physics.body, {...})` and have it Just Work, because `attach` does extra bookkeeping (deriving `invMass` from area, packing shape into `halfW`/`halfH`).
- **No CCD.** A small fast-moving body can tunnel through a thin static. Either bump the body's radius / box size, or use multiple thinner walls.
- **No sleeping bodies.** Every dynamic is integrated and pair-tested every step.
