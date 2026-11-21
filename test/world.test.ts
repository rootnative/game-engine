import { describe, expect, it } from 'vitest'

import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  destroyEntity,
  hasComponent,
  query,
  removeComponent,
} from '../src/core'
import type { EntityId, Query } from '../src/core'

function ids(q: Query): EntityId[] {
  const out: EntityId[] = []
  q.each((id) => out.push(id))
  return out
}

describe('createWorld', () => {
  it('refuses a capacity that is not a positive integer', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN]) {
      expect(() => createWorld({ capacity })).toThrow('positive integer')
    }
  })
})

describe('entities', () => {
  it('gives sequential ids and stops at the capacity', () => {
    const world = createWorld({ capacity: 3 })
    expect([
      createEntity(world),
      createEntity(world),
      createEntity(world),
    ]).toEqual([0, 1, 2])
    expect(() => createEntity(world)).toThrow('World capacity reached')
  })

  it('reuses destroyed ids, the last destroyed first', () => {
    const world = createWorld({ capacity: 4 })
    const [a, , c] = [
      createEntity(world),
      createEntity(world),
      createEntity(world),
    ]
    destroyEntity(world, a)
    destroyEntity(world, c)
    expect(createEntity(world)).toBe(c)
    expect(createEntity(world)).toBe(a)
    expect(createEntity(world)).toBe(3)
  })

  it('ignores a second destroy of the same id', () => {
    const world = createWorld({ capacity: 2 })
    const a = createEntity(world)
    createEntity(world)
    destroyEntity(world, a)
    destroyEntity(world, a)
    expect(createEntity(world)).toBe(a)
    expect(() => createEntity(world)).toThrow('World capacity reached')
  })

  it('gives a reused id no components', () => {
    const world = createWorld({ capacity: 1 })
    const Tag = defineComponent(world, { v: 'u8' })
    const a = createEntity(world)
    addComponent(world, a, Tag)
    destroyEntity(world, a)
    const b = createEntity(world)
    expect(b).toBe(a)
    expect(hasComponent(world, b, Tag)).toBe(false)
  })
})

describe('components', () => {
  it('allocates one typed buffer for each field, at the world capacity', () => {
    const world = createWorld({ capacity: 8 })
    const C = defineComponent(world, {
      a: 'f32',
      b: 'f64',
      c: 'i8',
      d: 'i16',
      e: 'i32',
      f: 'u8',
      g: 'u16',
      h: 'u32',
    })
    expect(C.data.a).toBeInstanceOf(Float32Array)
    expect(C.data.b).toBeInstanceOf(Float64Array)
    expect(C.data.c).toBeInstanceOf(Int8Array)
    expect(C.data.d).toBeInstanceOf(Int16Array)
    expect(C.data.e).toBeInstanceOf(Int32Array)
    expect(C.data.f).toBeInstanceOf(Uint8Array)
    expect(C.data.g).toBeInstanceOf(Uint16Array)
    expect(C.data.h).toBeInstanceOf(Uint32Array)
    for (const buffer of Object.values(C.data)) {
      expect(buffer).toHaveLength(8)
    }
  })

  it('gives each component the next bit', () => {
    const world = createWorld({ capacity: 1 })
    const bits = [0, 1, 2].map(() => defineComponent(world, { v: 'u8' }).bit)
    expect(bits).toEqual([1, 2, 4])
  })

  it('refuses a 33rd component', () => {
    const world = createWorld({ capacity: 1 })
    for (let i = 0; i < 32; i++) defineComponent(world, { v: 'u8' })
    expect(() => defineComponent(world, { v: 'u8' })).toThrow(
      'more than 32 components',
    )
  })

  it('sets the given fields and zeroes the others', () => {
    const world = createWorld({ capacity: 1 })
    const P = defineComponent(world, { x: 'f32', y: 'f32' })
    const id = createEntity(world)
    P.data.y[id] = 99
    addComponent(world, id, P, { x: 5 })
    expect(P.data.x[id]).toBe(5)
    expect(P.data.y[id]).toBe(0)
  })

  it('adds, checks and removes a component', () => {
    const world = createWorld({ capacity: 1 })
    const A = defineComponent(world, { v: 'u8' })
    const B = defineComponent(world, { v: 'u8' })
    const id = createEntity(world)
    addComponent(world, id, A)
    addComponent(world, id, B)
    removeComponent(world, id, A)
    expect(hasComponent(world, id, A)).toBe(false)
    expect(hasComponent(world, id, B)).toBe(true)
  })

  // Bit 31 is the sign bit of a 32-bit integer, so `1 << 31` is negative.
  it('supports the 32nd component', () => {
    const world = createWorld({ capacity: 2 })
    const all = Array.from({ length: 32 }, () =>
      defineComponent(world, { v: 'u8' }),
    )
    const first = all[0]
    const last = all[31]
    const a = createEntity(world)
    const b = createEntity(world)
    addComponent(world, a, first)
    addComponent(world, a, last)
    addComponent(world, b, first)
    expect(hasComponent(world, a, last)).toBe(true)
    expect(hasComponent(world, b, last)).toBe(false)
    expect(ids(query(world, first, last))).toEqual([a])
    removeComponent(world, a, last)
    expect(hasComponent(world, a, last)).toBe(false)
    expect(hasComponent(world, a, first)).toBe(true)
  })
})

describe('query', () => {
  it('matches only the entities that have each component', () => {
    const world = createWorld({ capacity: 4 })
    const A = defineComponent(world, { v: 'u8' })
    const B = defineComponent(world, { v: 'u8' })
    const onlyA = createEntity(world)
    const both = createEntity(world)
    const onlyB = createEntity(world)
    addComponent(world, onlyA, A)
    addComponent(world, both, A)
    addComponent(world, both, B)
    addComponent(world, onlyB, B)
    expect(ids(query(world, A, B))).toEqual([both])
    expect(ids(query(world, A))).toEqual([onlyA, both])
  })

  it('skips a destroyed entity, and finds a reused id again', () => {
    const world = createWorld({ capacity: 2 })
    const A = defineComponent(world, { v: 'u8' })
    const a = createEntity(world)
    const b = createEntity(world)
    addComponent(world, a, A)
    addComponent(world, b, A)
    destroyEntity(world, a)
    expect(ids(query(world, A))).toEqual([b])
    const reused = createEntity(world)
    addComponent(world, reused, A)
    expect(ids(query(world, A))).toEqual([reused, b])
  })

  it('matches each living entity when it has no components', () => {
    const world = createWorld({ capacity: 3 })
    const a = createEntity(world)
    const b = createEntity(world)
    const c = createEntity(world)
    destroyEntity(world, b)
    expect(ids(query(world))).toEqual([a, c])
  })

  it('sees an entity that the world got after the query was made', () => {
    const world = createWorld({ capacity: 2 })
    const A = defineComponent(world, { v: 'u8' })
    const q = query(world, A)
    const id = createEntity(world)
    addComponent(world, id, A)
    expect(ids(q)).toEqual([id])
  })
})
