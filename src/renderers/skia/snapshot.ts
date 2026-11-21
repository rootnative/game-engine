import type { Component, World } from '../../core/types'

export type PositionComponent = Component<{ x: 'f32'; y: 'f32' }>
export type SpriteComponent = Component<{
  atlas: 'u32'
  frame: 'u16'
  tint: 'u32'
}>

/** Floats per sprite: x, y, atlas, frame, then the tint bytes r, g, b, a. */
export const STRIDE = 8

const NO_TINT = 0xffffffff

/**
 * Packs each living entity with `position` and `sprite` into one array for
 * the UI thread. The tint goes in as 4 bytes, because a `Float32Array` can't
 * hold each 32-bit value exactly.
 */
export function packSprites(
  world: World,
  position: PositionComponent,
  sprite: SpriteComponent,
): Float32Array {
  const required = position.bit | sprite.bit
  const n = world.nextId
  const alive = world.alive
  const mask = world.mask
  const px = position.data.x as Float32Array
  const py = position.data.y as Float32Array
  const atlas = sprite.data.atlas as Uint32Array
  const frame = sprite.data.frame as Uint16Array
  const tint = sprite.data.tint as Uint32Array

  let count = 0
  for (let i = 0; i < n; i++) {
    if (alive[i] === 1 && (mask[i] & required) === required) count++
  }
  const out = new Float32Array(count * STRIDE)
  let j = 0
  for (let i = 0; i < n; i++) {
    if (alive[i] !== 1 || (mask[i] & required) !== required) continue
    // 0 means no tint: `addComponent` writes 0 to each field that it isn't
    // given, so a sprite with no tint must draw unchanged.
    const t = tint[i] === 0 ? NO_TINT : tint[i]
    out[j] = px[i]
    out[j + 1] = py[i]
    out[j + 2] = atlas[i]
    out[j + 3] = frame[i]
    out[j + 4] = t >>> 24
    out[j + 5] = (t >>> 16) & 0xff
    out[j + 6] = (t >>> 8) & 0xff
    out[j + 7] = t & 0xff
    j += STRIDE
  }
  return out
}
