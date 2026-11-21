import {
  BlendMode,
  Canvas,
  Picture,
  Skia,
  createPicture,
  type SkColor,
  type SkHostRect,
  type SkImage,
  type SkPicture,
  type SkRSXform,
} from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { StyleSheet } from 'react-native'
import {
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import { useEngine } from '../../GameEngine'
import type { World } from '../../core/types'
import {
  STRIDE,
  packSprites,
  type PositionComponent,
  type SpriteComponent,
} from './snapshot'

export interface SkiaFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SkiaAtlas {
  readonly image: SkImage | null
  readonly frames: ReadonlyArray<SkiaFrame>
}

export interface SkiaRendererProps {
  readonly world: World
  readonly position: PositionComponent
  readonly sprite: SpriteComponent
  readonly atlases: SharedValue<ReadonlyArray<SkiaAtlas>>
}

const BACKGROUND = '#fafafa'
const EMPTY = new Float32Array(0)
// r = s * d: each pixel of the sprite times the tint color.
const TINT_BLEND = BlendMode.Modulate

export function SkiaRenderer({
  world,
  position,
  sprite,
  atlases,
}: SkiaRendererProps) {
  const engine = useEngine()
  const packed = useSharedValue<Float32Array>(EMPTY)

  const paint = useMemo(() => {
    const p = Skia.Paint()
    p.setAntiAlias(true)
    return p
  }, [])

  // Pools live across worklet runs (Reanimated caches the captured arrays per
  // closure). They grow monotonically as entity counts climb; setXYWH / set
  // mutate in place so the inner loop is allocation-free in steady state.
  const srcPool = useMemo<SkHostRect[]>(() => [], [])
  const dstPool = useMemo<SkRSXform[]>(() => [], [])
  const colorPool = useMemo<SkColor[]>(() => [], [])
  const srcDraw = useMemo<SkHostRect[]>(() => [], [])
  const dstDraw = useMemo<SkRSXform[]>(() => [], [])
  const colorDraw = useMemo<SkColor[]>(() => [], [])

  useEffect(() => {
    return engine.onAfterStep(() => {
      packed.value = packSprites(world, position, sprite)
    })
  }, [engine, world, packed, position, sprite])

  const picture = useDerivedValue<SkPicture>(() => {
    const arr = packed.value
    const list = atlases.value
    const len = arr.length
    const atlasCount = list.length
    return createPicture((canvas) => {
      if (len === 0 || atlasCount === 0) return
      for (let a = 0; a < atlasCount; a++) {
        const atlasItem = list[a]
        if (!atlasItem || !atlasItem.image) continue
        const frames = atlasItem.frames
        let n = 0
        let tinted = false
        for (let k = 0; k < len; k += STRIDE) {
          if ((arr[k + 2] | 0) !== a) continue
          const f = frames[arr[k + 3] | 0]
          if (!f) continue
          if (n >= srcPool.length) {
            srcPool.push(Skia.XYWHRect(0, 0, 0, 0))
            dstPool.push(Skia.RSXform(1, 0, 0, 0))
            colorPool.push(new Float32Array(4))
          }
          const sf = srcPool[n]
          const df = dstPool[n]
          const cf = colorPool[n]
          sf.setXYWH(f.x, f.y, f.width, f.height)
          df.set(1, 0, arr[k] - f.width * 0.5, arr[k + 1] - f.height * 0.5)
          const r = arr[k + 4]
          const g = arr[k + 5]
          const b = arr[k + 6]
          const al = arr[k + 7]
          if (r !== 255 || g !== 255 || b !== 255 || al !== 255) tinted = true
          cf[0] = r / 255
          cf[1] = g / 255
          cf[2] = b / 255
          cf[3] = al / 255
          srcDraw[n] = sf
          dstDraw[n] = df
          colorDraw[n] = cf
          n++
        }
        if (n === 0) continue
        if (srcDraw.length !== n) srcDraw.length = n
        if (dstDraw.length !== n) dstDraw.length = n
        if (colorDraw.length !== n) colorDraw.length = n
        // A batch with no tint draws with no colors, which skips the blend.
        if (tinted) {
          canvas.drawAtlas(
            atlasItem.image,
            srcDraw,
            dstDraw,
            paint,
            TINT_BLEND,
            colorDraw,
          )
        } else {
          canvas.drawAtlas(atlasItem.image, srcDraw, dstDraw, paint)
        }
      }
    })
  })

  return (
    <Canvas style={styles.canvas}>
      <Picture picture={picture} />
    </Canvas>
  )
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: BACKGROUND },
})
