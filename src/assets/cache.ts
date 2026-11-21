/**
 * Returns the Promise in `cache` for `key`, or starts `load` and keeps its
 * Promise there, so each call for one key shares one load. A load that
 * fails leaves the cache, so the next call (or a Suspense retry) loads again.
 */
export function loadOnce<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const cached = cache.get(key)
  if (cached) return cached
  const promise = load()
  cache.set(key, promise)
  promise.catch(() => {
    // A clear and a new load can come before this failure. Keep the new one.
    if (cache.get(key) === promise) cache.delete(key)
  })
  return promise
}
