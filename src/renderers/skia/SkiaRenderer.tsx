import {
  Canvas,
  Picture,
  Skia,
  createPicture,
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
import type { Component, World } from '../../core/types'

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

type PositionComponent = Component<{ x: 'f32'; y: 'f32' }>
type SpriteComponent = Component<{ atlas: 'u32'; frame: 'u16'; tint: 'u32' }>

export interface SkiaRendererProps {
  readonly world: World
  readonly position: PositionComponent
  readonly sprite: SpriteComponent
  readonly atlases: SharedValue<ReadonlyArray<SkiaAtlas>>
}

const BACKGROUND = '#fafafa'
const EMPTY = new Float32Array(0)
const STRIDE = 4

export function SkiaRenderer({
  world,
  position,
  sprite,
  atlases,
}: SkiaRendererProps) {
  const positionBit = position.bit
  const spriteBit = sprite.bit
  const required = positionBit | spriteBit

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
  const srcDraw = useMemo<SkHostRect[]>(() => [], [])
  const dstDraw = useMemo<SkRSXform[]>(() => [], [])

  useEffect(() => {
    return engine.onAfterStep(() => {
      const n = world.nextId
      const alive = world.alive
      const mask = world.mask
      const px = position.data.x as Float32Array
      const py = position.data.y as Float32Array
      const atlas = sprite.data.atlas as Uint32Array
      const frame = sprite.data.frame as Uint16Array

      let count = 0
      for (let i = 0; i < n; i++) {
        if (alive[i] === 1 && (mask[i] & required) === required) count++
      }
      const out = new Float32Array(count * STRIDE)
      let j = 0
      for (let i = 0; i < n; i++) {
        if (alive[i] === 1 && (mask[i] & required) === required) {
          out[j] = px[i]
          out[j + 1] = py[i]
          out[j + 2] = atlas[i]
          out[j + 3] = frame[i]
          j += STRIDE
        }
      }
      packed.value = out
    })
  }, [engine, world, packed, position, sprite, required])

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
        for (let k = 0; k < len; k += STRIDE) {
          if ((arr[k + 2] | 0) !== a) continue
          const f = frames[arr[k + 3] | 0]
          if (!f) continue
          if (n >= srcPool.length) {
            srcPool.push(Skia.XYWHRect(0, 0, 0, 0))
            dstPool.push(Skia.RSXform(1, 0, 0, 0))
          }
          const sf = srcPool[n]
          const df = dstPool[n]
          sf.setXYWH(f.x, f.y, f.width, f.height)
          df.set(1, 0, arr[k] - f.width * 0.5, arr[k + 1] - f.height * 0.5)
          srcDraw[n] = sf
          dstDraw[n] = df
          n++
        }
        if (n === 0) continue
        if (srcDraw.length !== n) srcDraw.length = n
        if (dstDraw.length !== n) dstDraw.length = n
        canvas.drawAtlas(atlasItem.image, srcDraw, dstDraw, paint)
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
