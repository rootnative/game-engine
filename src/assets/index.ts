import { Asset } from 'expo-asset'
import { Directory, File, Paths } from 'expo-file-system'
import { use } from 'react'

export type AssetSource = number | string

export interface LoadedAsset {
  readonly source: AssetSource
  readonly localUri: string
  readonly width?: number
  readonly height?: number
}

const inflight = new Map<AssetSource, Promise<LoadedAsset>>()

export function loadAsset(source: AssetSource): Promise<LoadedAsset> {
  let p = inflight.get(source)
  if (!p) {
    p = resolve(source)
    inflight.set(source, p)
  }
  return p
}

export function useAsset(source: AssetSource): LoadedAsset {
  return use(loadAsset(source))
}

export function clearAssetCache(): void {
  inflight.clear()
}

async function resolve(source: AssetSource): Promise<LoadedAsset> {
  if (typeof source === 'number') return resolveBundled(source)
  return resolveRemote(source)
}

async function resolveBundled(source: number): Promise<LoadedAsset> {
  const asset = Asset.fromModule(source)
  if (!asset.downloaded) await asset.downloadAsync()
  return {
    source,
    localUri: asset.localUri ?? asset.uri,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
  }
}

async function resolveRemote(url: string): Promise<LoadedAsset> {
  const dir = new Directory(Paths.cache, 'engine-assets')
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true })

  const filename = `${hashString(url)}${inferExtension(url)}`
  const file = new File(dir, filename)

  if (!file.exists) {
    await File.downloadFileAsync(url, file, { idempotent: true })
  }

  return { source: url, localUri: file.uri }
}

function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

function inferExtension(url: string): string {
  const m = url.match(/\.[a-z0-9]{1,5}(?=\?|$)/i)
  return m ? m[0] : ''
}
