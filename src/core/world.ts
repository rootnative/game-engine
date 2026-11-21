import type {
  Component,
  ComponentSchema,
  EntityId,
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
  let id: EntityId
  if (world.freeCount > 0) {
    id = world.freeList[--world.freeCount]
  } else {
    if (world.nextId >= world.capacity) {
      throw new Error('World capacity reached')
    }
    id = world.nextId++
  }
  world.alive[id] = 1
  world.mask[id] = 0
  return id
}

export function destroyEntity(world: World, id: EntityId): void {
  if (world.alive[id] === 0) return
  world.alive[id] = 0
  world.mask[id] = 0
  world.freeList[world.freeCount++] = id
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
