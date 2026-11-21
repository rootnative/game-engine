import type {
  Component,
  ComponentSchema,
  EntityId,
  MutableWorld,
  TypedArrayFor,
  World,
} from './types'

export interface CreateWorldOptions {
  readonly capacity: number
}

export function createWorld(opts: CreateWorldOptions): World {
  const { capacity } = opts
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error('World capacity must be a positive integer')
  }
  return {
    capacity,
    components: [],
    alive: new Uint8Array(capacity),
    mask: new Uint32Array(capacity),
    freeList: new Uint32Array(capacity),
    freeCount: 0,
    nextId: 0,
  }
}

export function createEntity(world: World): EntityId {
  const w = world as MutableWorld
  let id: EntityId
  if (w.freeCount > 0) {
    id = w.freeList[--w.freeCount]
  } else {
    if (w.nextId >= w.capacity) {
      throw new Error('World capacity reached')
    }
    id = w.nextId++
  }
  w.alive[id] = 1
  w.mask[id] = 0
  return id
}

export function destroyEntity(world: World, id: EntityId): void {
  const w = world as MutableWorld
  if (w.alive[id] === 0) return
  w.alive[id] = 0
  w.mask[id] = 0
  w.freeList[w.freeCount++] = id
}

export function addComponent<S extends ComponentSchema>(
  world: World,
  id: EntityId,
  component: Component<S>,
  values?: Partial<{ readonly [K in keyof S]: number }>,
): void {
  world.mask[id] |= component.bit
  const data = component.data as Record<string, TypedArrayFor<S[keyof S]>>
  for (const key of Object.keys(component.schema)) {
    data[key][id] = values?.[key] ?? 0
  }
}

export function removeComponent(
  world: World,
  id: EntityId,
  component: Component,
): void {
  world.mask[id] &= ~component.bit
}

export function hasComponent(
  world: World,
  id: EntityId,
  component: Component,
): boolean {
  return (world.mask[id] & component.bit) !== 0
}
