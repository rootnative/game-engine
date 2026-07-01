# Assets

```ts
import { loadAsset, useAsset, clearAssetCache } from '@rootnative/game-engine';
import type { AssetSource, LoadedAsset } from '@rootnative/game-engine';
```

One API for **bundled assets** (`require('./img.png')`) and **remote URLs** (`'https://.../img.png'`). Resolution is async and Suspense-friendly — the engine never blocks the simulation loop on I/O.

The asset loader is renderer-agnostic. It returns a `localUri` and (where available) `width` / `height`; the renderer is responsible for turning that into a Skia `SkImage`, GL texture, or whatever it needs.

---

## `AssetSource`

```ts
type AssetSource = number | string;
```

- **`number`** — the value `require('./path/to/img.png')` returns. Resolved via `expo-asset`.
- **`string`** — an absolute URL. Resolved via `expo-file-system`'s `File.downloadFileAsync` and cached on disk.

---

## `LoadedAsset`

```ts
interface LoadedAsset {
  readonly source: AssetSource;
  readonly localUri: string;       // file:// URI ready for native APIs
  readonly width?: number;         // present for bundled images
  readonly height?: number;
}
```

`width` and `height` are **only set for bundled images**, where `expo-asset` reports them. Remote URLs return without dimensions — decode the image yourself if you need them (e.g., `Skia.Image.MakeImageFromEncoded`).

---

## `loadAsset(source)`

```ts
function loadAsset(source: AssetSource): Promise<LoadedAsset>;
```

Resolves the asset and returns a cached `Promise<LoadedAsset>`.

**Promise-level deduplication.** All calls to `loadAsset` for the same source share one in-flight `Promise`:

```ts
loadAsset(require('./ball.png')); // starts download
loadAsset(require('./ball.png')); // returns the same Promise
loadAsset(require('./ball.png')); // and the same Promise
```

This is what makes `useAsset` (which calls `use(loadAsset(...))`) safe to call from multiple components without thundering-herd downloads.

### Bundled (`number`) sources

```ts
const asset = await loadAsset(require('./assets/ball.png'));
// asset.localUri  → 'file:///.../ball.png'
// asset.width     → e.g. 16
// asset.height    → e.g. 16
```

`expo-asset` handles the actual download (in dev) or `localUri` resolution (in release). The first call awaits `Asset.downloadAsync()` if needed; subsequent calls return immediately.

### Remote (`string`) sources

```ts
const asset = await loadAsset('https://example.com/spritesheet.png');
// asset.localUri  → 'file:///.../engine-assets/<urlhash>.png'
```

The first call:

1. Ensures `Paths.cache/engine-assets/` exists.
2. Hashes the URL with djb2 into a base-36 filename, appending the URL's extension if any.
3. Downloads via `File.downloadFileAsync`.

Subsequent calls (same URL, same app install) skip the download and return the on-disk path.

> **Cache invalidation caveat.** The cache filename hashes the **URL**, not the response body. A URL that serves different bytes over time (`/sprite.png` updated server-side) will keep returning the stale cached file. Use versioned URLs (`/v1.2.3/sprite.png`) or call `clearAssetCache()` and re-download.
>
> `clearAssetCache()` only clears the in-flight `Promise` map — it does **not** delete files from disk. To wipe disk cache, delete `Paths.cache/engine-assets/` yourself via `expo-file-system`.

---

## `useAsset(source)`

```ts
function useAsset(source: AssetSource): LoadedAsset;
```

React 19 Suspense hook. Internally:

```ts
export function useAsset(source: AssetSource): LoadedAsset {
  return use(loadAsset(source));
}
```

Wrap consumers in `<Suspense fallback={...}>`. The shared in-flight `Promise` means it's safe to call `useAsset(sameSource)` from multiple components — they all suspend on the same Promise and resume together.

```tsx
import { Suspense } from 'react';
import { useAsset } from '@rootnative/game-engine';

function Ball() {
  const asset = useAsset(require('./ball.png'));
  // asset.localUri is ready
  return null;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Ball />
    </Suspense>
  );
}
```

> **Don't call `useAsset` inside `<GameEngine>` children if you can't afford a remount on suspend.** Suspense unmounts subtrees while pending — that includes the engine. If you want the engine to mount once and assets to load opportunistically, fetch with `loadAsset(...)` outside the React tree (or inside a sibling `<Suspense>` boundary) and pass the result down.

---

## `clearAssetCache()`

```ts
function clearAssetCache(): void;
```

Drops the in-flight `Promise` map. The next `loadAsset(source)` call will resolve fresh:

- Bundled sources re-query `expo-asset`.
- Remote sources re-check disk and re-download if the file is missing.

This does **not** delete cached files from disk. Use it after deleting files yourself, or to force a re-resolve in tests.

---

## Patterns

### Wiring assets to a renderer

The Skia renderer takes a `SharedValue<ReadonlyArray<SkiaAtlas>>` indexed by `Sprite.atlas`, with `Sprite.frame` selecting a sub-rect of each atlas image. The renderer ships a helper that wraps `loadAsset` + `Skia.Image.MakeImageFromEncoded`:

```tsx
import { loadSkiaAtlas, gridFrames, type SkiaAtlas } from '@rootnative/game-engine/renderers/skia';

const atlases = useSharedValue<ReadonlyArray<SkiaAtlas>>([]);

useEffect(() => {
  Promise.all([
    loadSkiaAtlas(require('./ball.png')),                      // single-frame atlas
    loadSkiaAtlas(
      require('./hero.png'),
      gridFrames({ frameWidth: 32, frameHeight: 32, columns: 8, rows: 4 }),
    ),                                                          // 32-frame sheet
  ]).then((list) => {
    atlases.value = list;
  });
}, [atlases]);
```

`loadSkiaAtlas` reuses the asset cache (in-flight dedupe, disk cache for remote URLs), so the same `Promise<SkiaAtlas>` can be awaited from multiple call sites without redecoding. See [the Skia renderer doc](./api-renderer-skia.md) for the full atlas + frame indexing model.

### Preloading

If you want to block the loading screen until everything's on disk:

```ts
await Promise.all([
  loadAsset(require('./ball.png')),
  loadAsset(require('./paddle.png')),
  loadAsset('https://cdn.example.com/level-1.png'),
]);
```

Each call dedupes against the next `useAsset(source)` of the same source — Suspense will not re-block.
