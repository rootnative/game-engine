import { Skia, type SkImage } from '@shopify/react-native-skia'

import { loadAsset, type AssetSource } from '../../assets'
import type { SkiaAtlas, SkiaFrame } from './SkiaRenderer'

export async function loadSkiaImage(source: AssetSource): Promise<SkImage> {
  const asset = await loadAsset(source)
  const data = await Skia.Data.fromURI(asset.localUri)
  const image = Skia.Image.MakeImageFromEncoded(data)
  if (!image) {
    throw new Error(
      `SkiaRenderer: failed to decode image from ${asset.localUri}`,
    )
  }
  return image
}

export async function loadSkiaAtlas(
  source: AssetSource,
  frames?: ReadonlyArray<SkiaFrame>,
): Promise<SkiaAtlas> {
  const image = await loadSkiaImage(source)
  return {
    image,
    frames: frames ?? [
      { x: 0, y: 0, width: image.width(), height: image.height() },
    ],
  }
}

export interface GridFramesOptions {
  readonly frameWidth: number
  readonly frameHeight: number
  readonly columns: number
  readonly rows: number
  readonly count?: number
  readonly offsetX?: number
  readonly offsetY?: number
  readonly spacingX?: number
  readonly spacingY?: number
}

export function gridFrames(opts: GridFramesOptions): SkiaFrame[] {
  const {
    frameWidth,
    frameHeight,
    columns,
    rows,
    count = columns * rows,
    offsetX = 0,
    offsetY = 0,
    spacingX = 0,
    spacingY = 0,
  } = opts
  const out: SkiaFrame[] = []
  for (let i = 0; i < count; i++) {
    const c = i % columns
    const r = (i / columns) | 0
    out.push({
      x: offsetX + c * (frameWidth + spacingX),
      y: offsetY + r * (frameHeight + spacingY),
      width: frameWidth,
      height: frameHeight,
    })
  }
  return out
}
