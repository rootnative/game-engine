import type {
  Component,
  ComponentBuffer,
  ComponentSchema,
  FieldType,
  TypedArrayFor,
  World,
} from './types'

const MAX_COMPONENTS = 32

function allocBuffer(
  type: FieldType,
  capacity: number,
): TypedArrayFor<FieldType> {
  switch (type) {
    case 'f32':
      return new Float32Array(capacity)
    case 'f64':
      return new Float64Array(capacity)
    case 'i8':
      return new Int8Array(capacity)
    case 'i16':
      return new Int16Array(capacity)
    case 'i32':
      return new Int32Array(capacity)
    case 'u8':
      return new Uint8Array(capacity)
    case 'u16':
      return new Uint16Array(capacity)
    case 'u32':
      return new Uint32Array(capacity)
  }
}

export function defineComponent<S extends ComponentSchema>(
  world: World,
  schema: S,
): Component<S> {
  if (world.components.length >= MAX_COMPONENTS) {
    throw new Error(
      `Cannot define more than ${MAX_COMPONENTS} components per world`,
    )
  }
  const id = world.components.length
  const bit = 1 << id
  const data: Record<string, TypedArrayFor<FieldType>> = {}
  for (const key of Object.keys(schema)) {
    data[key] = allocBuffer(schema[key], world.capacity)
  }
  const component: Component<S> = {
    id,
    bit,
    schema,
    data: data as ComponentBuffer<S>,
  }
  world.components.push(component)
  return component
}
