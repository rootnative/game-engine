import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-ins for the two Expo modules, which need a device. The fake file
// system keeps the URIs of the downloaded files in a set.
const mocks = vi.hoisted(() => {
  const files = new Set<string>()
  const downloads: Array<{ url: string; uri: string }> = []

  class Directory {
    readonly uri: string
    readonly exists = false
    constructor(parent: string, name: string) {
      this.uri = `${parent}/${name}`
    }
    create(): void {}
  }

  class File {
    readonly uri: string
    constructor(dir: Directory, name: string) {
      this.uri = `${dir.uri}/${name}`
    }
    get exists(): boolean {
      return files.has(this.uri)
    }
    static async downloadFileAsync(url: string, file: File): Promise<File> {
      downloads.push({ url, uri: file.uri })
      files.add(file.uri)
      return file
    }
  }

  return { files, downloads, Directory, File, fromModule: vi.fn() }
})

vi.mock('expo-asset', () => ({ Asset: { fromModule: mocks.fromModule } }))
vi.mock('expo-file-system', () => ({
  Directory: mocks.Directory,
  File: mocks.File,
  Paths: { cache: 'file:///cache' },
}))

import { clearAssetCache, loadAsset } from '../src/assets'
import { loadOnce } from '../src/assets/cache'

const CACHED_FILE = /^file:\/\/\/cache\/engine-assets\/[0-9a-z]+/

function bundled(overrides: Record<string, unknown> = {}) {
  return {
    downloaded: false,
    downloadAsync: vi.fn(async () => {}),
    localUri: 'file:///bundle/ball.png',
    uri: 'http://dev-server/ball.png',
    width: 32,
    height: 16,
    ...overrides,
  }
}

beforeEach(() => {
  clearAssetCache()
  mocks.files.clear()
  mocks.downloads.length = 0
  mocks.fromModule.mockReset()
})

describe('loadAsset with a bundled asset', () => {
  it('returns one shared Promise for each source', async () => {
    mocks.fromModule.mockReturnValue(bundled())
    const first = loadAsset(7)
    expect(loadAsset(7)).toBe(first)
    await first
    expect(mocks.fromModule).toHaveBeenCalledTimes(1)
  })

  it('downloads the asset, and gives its local file and size', async () => {
    const asset = bundled()
    mocks.fromModule.mockReturnValue(asset)
    await expect(loadAsset(7)).resolves.toEqual({
      source: 7,
      localUri: 'file:///bundle/ball.png',
      width: 32,
      height: 16,
    })
    expect(asset.downloadAsync).toHaveBeenCalledTimes(1)
  })

  it('skips the download of an asset that is on the device', async () => {
    const asset = bundled({
      downloaded: true,
      localUri: null,
      width: null,
      height: null,
    })
    mocks.fromModule.mockReturnValue(asset)
    await expect(loadAsset(7)).resolves.toEqual({
      source: 7,
      localUri: 'http://dev-server/ball.png',
    })
    expect(asset.downloadAsync).not.toHaveBeenCalled()
  })

  it('starts a new load after clearAssetCache', async () => {
    mocks.fromModule.mockReturnValue(bundled())
    const first = loadAsset(7)
    await first
    clearAssetCache()
    const second = loadAsset(7)
    expect(second).not.toBe(first)
    await second
    expect(mocks.fromModule).toHaveBeenCalledTimes(2)
  })
})

describe('loadAsset with a URL', () => {
  it('downloads the URL into the cache, in a file named by a hash and the extension', async () => {
    const url = 'https://cdn.example.com/sprites/ball.png?v=2'
    const asset = await loadAsset(url)
    expect(asset.source).toBe(url)
    expect(asset.localUri).toMatch(new RegExp(`${CACHED_FILE.source}\\.png$`))
    expect(mocks.downloads).toEqual([{ url, uri: asset.localUri }])
  })

  it('names the file with no extension when the URL has none', async () => {
    const asset = await loadAsset('https://cdn.example.com/level')
    expect(asset.localUri).toMatch(new RegExp(`${CACHED_FILE.source}$`))
  })

  it('gives two URLs two files', async () => {
    const a = await loadAsset('https://cdn.example.com/a.glb')
    const b = await loadAsset('https://cdn.example.com/b.glb')
    expect(a.localUri).not.toBe(b.localUri)
  })

  it('uses the file on disk for a URL that it downloaded before', async () => {
    const url = 'https://cdn.example.com/a.glb'
    const first = await loadAsset(url)
    clearAssetCache()
    const second = await loadAsset(url)
    expect(second.localUri).toBe(first.localUri)
    expect(mocks.downloads).toHaveLength(1)
  })
})

describe('a failed load', () => {
  function failingAsset(error = new Error('offline')) {
    return bundled({
      downloadAsync: vi.fn(async () => {
        throw error
      }),
    })
  }

  it('leaves the cache, so the next call loads again', async () => {
    mocks.fromModule
      .mockReturnValueOnce(failingAsset())
      .mockReturnValueOnce(bundled())
    await expect(loadAsset(7)).rejects.toThrow('offline')
    await expect(loadAsset(7)).resolves.toMatchObject({
      localUri: 'file:///bundle/ball.png',
    })
    expect(mocks.fromModule).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer load that started after clearAssetCache', async () => {
    let failFirst: (error: Error) => void = () => {}
    mocks.fromModule
      .mockReturnValueOnce(
        bundled({
          downloadAsync: () =>
            new Promise<void>((_, reject) => {
              failFirst = reject
            }),
        }),
      )
      .mockReturnValueOnce(bundled())
    const first = loadAsset(7)
    clearAssetCache()
    const second = loadAsset(7)
    failFirst(new Error('offline'))
    await expect(first).rejects.toThrow('offline')
    expect(loadAsset(7)).toBe(second)
    await second
  })
})

describe('loadOnce', () => {
  it('shares one load for each key', async () => {
    const cache = new Map<string, Promise<number>>()
    const load = vi.fn(async () => 1)
    const first = loadOnce(cache, 'a', load)
    expect(loadOnce(cache, 'a', load)).toBe(first)
    await first
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps a load that succeeded', async () => {
    const cache = new Map<string, Promise<number>>()
    await loadOnce(cache, 'a', async () => 1)
    expect(cache.has('a')).toBe(true)
  })

  it('drops a load that failed', async () => {
    const cache = new Map<string, Promise<number>>()
    await expect(
      loadOnce(cache, 'a', async () => {
        throw new Error('no')
      }),
    ).rejects.toThrow('no')
    expect(cache.has('a')).toBe(false)
  })
})
