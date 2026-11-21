export type EntityId = number

export type FieldType =
  'f32' | 'f64' | 'i8' | 'i16' | 'i32' | 'u8' | 'u16' | 'u32'

export type ComponentSchema = Record<string, FieldType>

export type ComponentBuffer<S extends ComponentSchema> = {
  readonly [K in keyof S]: TypedArrayFor<S[K]>
}

export type TypedArrayFor<T extends FieldType> = T extends 'f32'
  ? Float32Array
  : T extends 'f64'
    ? Float64Array
    : T extends 'i8'
      ? Int8Array
      : T extends 'i16'
        ? Int16Array
        : T extends 'i32'
          ? Int32Array
          : T extends 'u8'
            ? Uint8Array
            : T extends 'u16'
              ? Uint16Array
              : T extends 'u32'
                ? Uint32Array
                : never

export interface Component<S extends ComponentSchema = ComponentSchema> {
  readonly id: number
  readonly bit: number
  readonly schema: S
  readonly data: ComponentBuffer<S>
}

export interface World {
  readonly capacity: number
  readonly components: ReadonlyArray<Component>
  readonly alive: Uint8Array
  readonly mask: Uint32Array
  readonly freeList: Uint32Array
  readonly freeCount: number
  readonly nextId: EntityId
}

/**
 * @internal The writable shape of a `World`. Only the entity functions and
 * `defineComponent` write to a world.
 */
export interface MutableWorld extends Omit<
  World,
  'components' | 'freeCount' | 'nextId'
> {
  readonly components: Component[]
  freeCount: number
  nextId: EntityId
}

export interface TouchEvent {
  readonly id: number
  readonly type: 'start' | 'end' | 'move' | 'tap' | 'long-press'
  readonly x: number
  readonly y: number
  readonly dx?: number
  readonly dy?: number
  readonly t: number
}

export interface Pointer {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly down: boolean
}

export interface FrameContext {
  readonly time: {
    readonly current: number
    readonly previous: number
    readonly delta: number
  }
  readonly input: {
    readonly touches: ReadonlyArray<TouchEvent>
    readonly pointers: ReadonlyArray<Pointer>
  }
  readonly screen: {
    readonly width: number
    readonly height: number
  }
  readonly events: ReadonlyArray<GameEvent>
  readonly dispatch: (e: GameEvent) => void
}

export interface GameEvent {
  readonly type: string
  readonly payload?: unknown
}

export type System = (world: World, ctx: FrameContext) => void
