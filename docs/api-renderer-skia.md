# Skia renderer

```ts
import {
  SkiaRenderer,
  loadSkiaImage,
  loadSkiaAtlas,
  gridFrames,
} from '@rootnative/game-engine/renderers/skia';
import type {
  SkiaRendererProps,
  SkiaAtlas,
  SkiaFrame,
  GridFramesOptions,
} from '@rootnative/game-engine/renderers/skia';
```

A single `<Canvas>` driven by a Reanimated worklet that iterates a flat snapshot of the world on the UI thread. No React reconciliation per entity, no per-frame `runOnJS` / `runOnUI` calls.

The renderer is the **only** place the engine talks to Skia. It lives behind a subpath import so consumers who use a different renderer never pull `@shopify/react-native-skia` into their bundle.

---

## `<SkiaRenderer>` props

```ts
interface SkiaRendererProps {
  readonly world: World;
  readonly position: Component<{ x: 'f32'; y: 'f32' }>;
  readonly sprite:   Component<{ atlas: 'u32'; frame: 'u16'; tint: 'u32' }>;
  readonly atlases:  SharedValue<ReadonlyArray<SkiaAtlas>>;
}
```

### `world`

The same [`World`](./api-core.md#worlds) you pass to `<GameEngine>`.

### `position`

A component with `{ x: 'f32'; y: 'f32' }`. Each entity's `(x, y)` is the **center** of where the sprite is drawn.

The renderer doesn't care what you call this component — pass any component matching that schema. Most games use the `Position` component their physics step writes into.

### `sprite`

A component with `{ atlas: 'u32'; frame: 'u16'; tint: 'u32' }`:

- **`atlas`** — index into the `atlases` array. The renderer reads `atlases.value[atlas]` to find the source image.
- **`frame`** — index into that atlas's `frames` array. Picks which sub-rect of the atlas image to draw.
- **`tint`** — packed RGBA color. Reserved for tinting; **not yet read** by the renderer.

Only entities that have **both** `position` and `sprite` are drawn.

### `atlases`

A `SharedValue<ReadonlyArray<SkiaAtlas>>`. The renderer reads `atlases.value[sprite.atlas[id]].frames[sprite.frame[id]]` per entity inside a worklet.

```ts
interface SkiaAtlas {
  readonly image: SkImage | null;
  readonly frames: ReadonlyArray<SkiaFrame>;
}

interface SkiaFrame {
  readonly x: number;       // source rect, in atlas image pixels
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
```

A frame's `width` / `height` are both the source rect size **and** the destination size — the sprite is drawn at its natural size, centered at `(position.x, position.y)`. To rescale, pre-scale the atlas image or build a different atlas.

> Slots with `image: null` (texture still loading) and missing frames are silently skipped. The entity stays in the world, just invisible until the texture resolves.

---

## Loading atlases

The two helpers bridge the engine's [asset pipeline](./api-assets.md) to Skia's `SkImage`:

```ts
function loadSkiaImage(source: AssetSource): Promise<SkImage>;
function loadSkiaAtlas(
  source: AssetSource,
  frames?: ReadonlyArray<SkiaFrame>,
): Promise<SkiaAtlas>;
```

Both internally call `loadAsset(source)`, which means the same caching and Suspense semantics apply: bundled `require(...)` images and remote URLs both work, in-flight requests dedupe, and you can `use(loadSkiaAtlas(...))` from a Suspense boundary.

If `frames` is omitted, the atlas gets a single frame covering the entire image — the convenient default for one-image-per-sprite games.

```ts
const ball = await loadSkiaAtlas(require('./ball.png'));
// ball.frames === [{ x: 0, y: 0, width: ball.image.width(), height: ball.image.height() }]
```

For sprite sheets, supply explicit frame rects or use `gridFrames` to slice a uniform grid:

```ts
function gridFrames(opts: GridFramesOptions): SkiaFrame[];

interface GridFramesOptions {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly count?: number;     // defaults to columns * rows
  readonly offsetX?: number;   // top-left of the grid in the image
  readonly offsetY?: number;
  readonly spacingX?: number;  // gap between cells
  readonly spacingY?: number;
}
```

Frames are emitted in row-major order: `frame = row * columns + column`.

```tsx
const characterAtlas = await loadSkiaAtlas(
  require('./hero.png'),
  gridFrames({ frameWidth: 32, frameHeight: 32, columns: 8, rows: 4 }),
);
// 32 frames; frame 0 = top-left cell, frame 7 = top-right, frame 8 = next row.
```

---

## Wiring atlases into the renderer

`atlases` is a Reanimated shared value — the worklet reads `atlases.value` directly. Set it from JS once your textures are decoded:

```tsx
const atlases = useSharedValue<ReadonlyArray<SkiaAtlas>>([]);

useEffect(() => {
  Promise.all([
    loadSkiaAtlas(require('./ball.png')),
    loadSkiaAtlas(require('./paddle.png')),
    loadSkiaAtlas(
      require('./bricks.png'),
      gridFrames({ frameWidth: 40, frameHeight: 16, columns: 1, rows: 5 }),
    ),
  ]).then((list) => {
    atlases.value = list;
  });
}, [atlases]);
```

Then on each entity, set `Sprite.atlas` to the array index and `Sprite.frame` to the frame index:

```ts
addComponent(world, id, Sprite, { atlas: 2, frame: row, tint: 0 }); // colored brick
```

Building atlases procedurally with `Skia.Surface` works too — the renderer doesn't care where the `SkImage` came from.

---

## What the renderer draws

For each alive entity matching `position.bit | sprite.bit`:

```
const a = atlases.value[sprite.atlas];
const f = a.frames[sprite.frame];

canvas.drawImageRect(
  a.image,
  { x: f.x, y: f.y, width: f.width, height: f.height },                   // src rect
  {
    x: position.x - f.width  * 0.5,
    y: position.y - f.height * 0.5,
    width:  f.width,
    height: f.height,
  },                                                                      // dst rect
  paint, // antialiased, no tint
);
```

So:

- **Origin is centered.** `(position.x, position.y)` is the *center* of the drawn frame.
- **No rotation, no per-entity scale.** Scale is set per-frame at atlas-build time.
- **No tint.** The `tint` field is reserved for when paint masking lands.

---

## How frames flow

1. **Sim step ends.** The engine fires registered `loop.onAfterStep` callbacks once per tick that produced ≥1 step.
2. **Renderer's `onAfterStep` callback runs on the JS thread.** It scans `[0, world.nextId)` and packs every drawable entity into a fresh `Float32Array(count * 4)`:
   ```
   [x0, y0, atlas0, frame0, x1, y1, atlas1, frame1, ...]
   ```
3. **Assigning `packed.value = out` triggers Reanimated to clone the array to the UI thread.**
4. **The UI-thread `useDerivedValue` worklet wakes up.** It reads `packed.value` and `atlases.value`, builds an `SkPicture` with one `drawImageRect` per entity.
5. **The `<Picture>` element draws the picture.**

> **Reanimated 4 does not zero-copy TypedArrays** (`react-native-worklets` clones every `ArrayBuffer` / `ArrayBufferView` in `cloneArrayBuffer` / `cloneArrayBufferView`). The renderer pushes a fresh snapshot each frame; assigning a new `SharedValue` reference is what makes Reanimated re-clone.
>
> Cost: `world.nextId * 4 * 4` bytes copied per render frame — at phase-1 entity counts (≤200), this is comfortably negligible.

---

## Performance notes

- **Single `<Canvas>`.** All entities draw into one Skia surface; no React tree per sprite.
- **Snapshot, not iteration over the live world.** The worklet never touches `World` directly — Reanimated would have to clone the entire structure on every assignment.
- **Per-frame allocation: one `Float32Array`.** Replace with a pre-allocated buffer or a circular pair of buffers if profiling says it matters; today it doesn't.
- **`drawImageRect` allocates `SkRect`s per call.** Switch to `drawAtlas` once a single atlas image holds most of the scene; documented as a follow-up in the project's known caveats.

---

## Background color

Hardcoded to `#fafafa` today via the canvas's `backgroundColor` style. Wrap the renderer in your own `<View>` with a different background if you need control over this — the canvas' background draws under everything, so a wrapping view can show through transparency in the canvas content.

---

## Limitations / roadmap

- **Components named in props, not declared by renderer.** The renderer assumes its `position` and `sprite` props match the schemas above. There's no formal "renderer-component-API" yet — designing one is on the roadmap so renderers can declare which components they read.
- **`tint` not yet wired.** The field is accepted in the schema but ignored at draw time.
- **No rotation, no per-entity scale.** Per-frame size is fixed at atlas-build time.
- **One canvas, one z-order.** Entities draw in entity-id order. There's no z-sort yet — add a `z: 'i16'` field to the sprite component and sort the snapshot if you need it.
