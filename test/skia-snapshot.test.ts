import { describe, expect, it } from 'vitest'

import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  destroyEntity,
} from '../src/core'
import { STRIDE, packSprites } from '../src/renderers/skia/snapshot'

function setup() {
  const world = createWorld({ capacity: 8 })
  const Position = defineComponent(world, { x: 'f32', y: 'f32' })
  const Sprite = defineComponent(world, {
    atlas: 'u32',
    frame: 'u16',
    tint: 'u32',
  })
  const pack = () => Array.from(packSprites(world, Position, Sprite))
  return { world, Position, Sprite, pack }
}

describe('packSprites', () => {
  it('packs position, atlas, frame and the 4 tint bytes of each sprite', () => {
    const { world, Position, Sprite, pack } = setup()
    const id = createEntity(world)
    addComponent(world, id, Position, { x: 10, y: 20 })
    addComponent(world, id, Sprite, { atlas: 2, frame: 3, tint: 0x11223344 })
    expect(STRIDE).toBe(8)
    expect(pack()).toEqual([10, 20, 2, 3, 0x11, 0x22, 0x33, 0x44])
  })

  it('treats a tint of 0 as no tint, the same as white', () => {
    const { world, Position, Sprite, pack } = setup()
    for (const tint of [0, 0xffffffff]) {
      const id = createEntity(world)
      addComponent(world, id, Position)
      addComponent(world, id, Sprite, { tint })
    }
    const id = createEntity(world)
    addComponent(world, id, Position)
    addComponent(world, id, Sprite)
    expect(pack()).toEqual([
      ...[0, 0, 0, 0, 255, 255, 255, 255],
      ...[0, 0, 0, 0, 255, 255, 255, 255],
      ...[0, 0, 0, 0, 255, 255, 255, 255],
    ])
  })

  it('keeps each byte of a tint exact', () => {
    const { world, Position, Sprite, pack } = setup()
    const id = createEntity(world)
    addComponent(world, id, Position)
    addComponent(world, id, Sprite, { tint: 0xff8001fe })
    expect(pack().slice(4)).toEqual([0xff, 0x80, 0x01, 0xfe])
  })

  it('packs only living entities with both components', () => {
    const { world, Position, Sprite, pack } = setup()
    const onlyPosition = createEntity(world)
    addComponent(world, onlyPosition, Position, { x: 1 })
    const dead = createEntity(world)
    addComponent(world, dead, Position, { x: 2 })
    addComponent(world, dead, Sprite)
    destroyEntity(world, dead)
    const drawn = createEntity(world)
    addComponent(world, drawn, Position, { x: 3 })
    addComponent(world, drawn, Sprite)
    const packed = pack()
    expect(packed).toHaveLength(STRIDE)
    expect(packed[0]).toBe(3)
  })

  it('gives an empty array for a world with no sprites', () => {
    const { pack } = setup()
    expect(pack()).toEqual([])
  })
})
