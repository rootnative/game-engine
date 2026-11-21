import type { Component, EntityId, World } from './types'

export interface Query {
  each(fn: (id: EntityId) => void): void
}

export function query(world: World, ...components: Component[]): Query {
  let mask = 0
  for (let i = 0; i < components.length; i++) {
    mask |= components[i].bit
  }
  return {
    each(fn) {
      const alive = world.alive
      const masks = world.mask
      const n = world.nextId
      for (let id = 0; id < n; id++) {
        if (alive[id] === 1 && (masks[id] & mask) === mask) {
          fn(id)
        }
      }
    },
  }
}
