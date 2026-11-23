import { describe, expect, it } from 'vitest'

import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  destroyEntity,
} from '../src/core'
import type { FrameContext } from '../src/core'
import { createPhysics } from '../src/physics'
import type { BodyDef, PhysicsOptions } from '../src/physics'

const DT = 1 / 60

function frame(delta: number): FrameContext {
  return {
    time: { current: 0, previous: 0, delta },
    input: { touches: [], pointers: [] },
    screen: { width: 0, height: 0 },
    events: [],
    dispatch: () => {},
  }
}

function setup(
  gravity?: PhysicsOptions['gravity'],
  maxContacts?: PhysicsOptions['maxContacts'],
) {
  const world = createWorld({ capacity: 16 })
  const Position = defineComponent(world, { x: 'f32', y: 'f32' })
  const Velocity = defineComponent(world, { x: 'f32', y: 'f32' })
  const physics = createPhysics({
    world,
    position: Position,
    velocity: Velocity,
    gravity,
    maxContacts,
  })
  const body = (def: BodyDef) => {
    const id = createEntity(world)
    physics.attach(id, def)
    return id
  }
  const pos = (id: number) => [Position.data.x[id], Position.data.y[id]]
  const vel = (id: number) => [Velocity.data.x[id], Velocity.data.y[id]]
  const step = () => physics.step(world, frame(DT))
  return { world, Position, Velocity, physics, body, pos, vel, step }
}

const NO_GRAVITY = { x: 0, y: 0 }

interface Surface {
  readonly restitution?: number
  readonly friction?: number
  readonly sensor?: boolean
}

/**
 * A ball of radius 10 at the origin that moves down at 600 px/s, and a static
 * floor 200 wide and 20 high whose top edge is at y = 15. After one step at
 * 60 Hz, the ball has moved 10 px down and overlaps the floor by 5 px.
 */
function ballOnFloor(
  ball: Surface & { readonly vx?: number } = {},
  floor: Surface = {},
) {
  const { vx = 0, ...ballSurface } = ball
  const s = setup(NO_GRAVITY)
  s.body({
    type: 'static',
    position: { x: 0, y: 25 },
    shape: { kind: 'box', width: 200, height: 20 },
    ...floor,
  })
  const ballId = s.body({
    type: 'dynamic',
    position: { x: 0, y: 0 },
    velocity: { x: vx, y: 600 },
    shape: { kind: 'circle', radius: 10 },
    ...ballSurface,
  })
  return { ...s, ballId }
}

describe('integration', () => {
  it('adds gravity to the velocity, then moves the body by the new velocity', () => {
    const { body, pos, vel, step } = setup({ x: 0, y: 600 })
    const id = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 1 },
    })
    step()
    expect(vel(id)[1]).toBeCloseTo(10)
    expect(pos(id)[1]).toBeCloseTo(10 / 60)
  })

  it('uses 600 px/s² down when gravity is not given', () => {
    const { body, vel, step } = setup()
    const id = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 1 },
    })
    step()
    expect(vel(id)).toEqual([0, expect.closeTo(10)])
  })

  it('keeps a body still with zero gravity and no velocity', () => {
    const { body, pos, step } = setup(NO_GRAVITY)
    const id = body({
      type: 'dynamic',
      position: { x: 3, y: 4 },
      shape: { kind: 'circle', radius: 1 },
    })
    step()
    expect(pos(id)).toEqual([3, 4])
  })

  it('never moves a static body', () => {
    const { body, pos, step } = setup()
    const id = body({
      type: 'static',
      position: { x: 3, y: 4 },
      velocity: { x: 100, y: 100 },
      shape: { kind: 'box', width: 10, height: 10 },
    })
    step()
    expect(pos(id)).toEqual([3, 4])
  })
})

describe('mass', () => {
  it('takes the area as the mass when none is given', () => {
    const { body, physics } = setup()
    const circle = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 2 },
    })
    const box = body({
      type: 'dynamic',
      position: { x: 50, y: 0 },
      shape: { kind: 'box', width: 4, height: 5 },
    })
    const invMass = physics.body.data.invMass
    expect(invMass[circle]).toBeCloseTo(1 / (Math.PI * 4))
    expect(invMass[box]).toBeCloseTo(1 / 20)
  })

  it('gives a static body and a zero mass no inverse mass', () => {
    const { body, physics } = setup()
    const wall = body({
      type: 'static',
      position: { x: 0, y: 0 },
      shape: { kind: 'box', width: 4, height: 5 },
    })
    const anchor = body({
      type: 'dynamic',
      position: { x: 50, y: 0 },
      shape: { kind: 'circle', radius: 1 },
      mass: 0,
    })
    expect(physics.body.data.invMass[wall]).toBe(0)
    expect(physics.body.data.invMass[anchor]).toBe(0)
  })

  it('moves each body out of an overlap by its share of the inverse mass', () => {
    const { body, pos, step } = setup(NO_GRAVITY)
    const heavy = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 10 },
      mass: 3,
    })
    const light = body({
      type: 'dynamic',
      position: { x: 15, y: 0 },
      shape: { kind: 'circle', radius: 10 },
      mass: 1,
    })
    step()
    expect(pos(heavy)[0]).toBeCloseTo(-1.25)
    expect(pos(light)[0]).toBeCloseTo(18.75)
  })
})

describe('contacts', () => {
  it('rests a ball on a static floor when the restitution is 0', () => {
    const { ballId, pos, vel, step } = ballOnFloor()
    step()
    expect(pos(ballId)[1]).toBeCloseTo(5)
    expect(vel(ballId)[1]).toBeCloseTo(0)
  })

  it('bounces a ball when both bodies have a restitution of 1', () => {
    const { ballId, vel, step } = ballOnFloor(
      { restitution: 1 },
      { restitution: 1 },
    )
    step()
    expect(vel(ballId)[1]).toBeCloseTo(-600)
  })

  it('uses the smaller restitution of the two bodies', () => {
    const { ballId, vel, step } = ballOnFloor({ restitution: 1 })
    step()
    expect(vel(ballId)[1]).toBeCloseTo(0)
  })

  it('keeps the sliding speed with no friction', () => {
    const { ballId, vel, step } = ballOnFloor({ vx: 300 })
    step()
    expect(vel(ballId)[0]).toBeCloseTo(300)
  })

  it('stops the sliding when the friction is high enough', () => {
    const { ballId, vel, step } = ballOnFloor(
      { vx: 300, friction: 1 },
      { friction: 1 },
    )
    step()
    expect(vel(ballId)[0]).toBeCloseTo(0)
  })

  it('limits the friction impulse to the friction times the normal impulse', () => {
    const { ballId, vel, step } = ballOnFloor(
      { vx: 300, friction: 0.25 },
      { friction: 0.25 },
    )
    step()
    expect(vel(ballId)[0]).toBeCloseTo(150)
  })

  it('swaps the velocities of two equal balls in an elastic head-on hit', () => {
    const { body, vel, step } = setup(NO_GRAVITY)
    const a = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      velocity: { x: 100, y: 0 },
      shape: { kind: 'circle', radius: 10 },
      restitution: 1,
    })
    const b = body({
      type: 'dynamic',
      position: { x: 19, y: 0 },
      velocity: { x: -100, y: 0 },
      shape: { kind: 'circle', radius: 10 },
      restitution: 1,
    })
    step()
    expect(vel(a)[0]).toBeCloseTo(-100)
    expect(vel(b)[0]).toBeCloseTo(100)
  })

  it('moves two balls at the same point apart on the x axis', () => {
    const { body, physics, pos, step } = setup(NO_GRAVITY)
    const ball = {
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 10 },
    } as const
    const a = body(ball)
    const b = body(ball)
    step()
    expect(pos(a)).toEqual([-10, 0])
    expect(pos(b)).toEqual([10, 0])
    expect(physics.contacts.count).toBe(1)
    expect(physics.contacts.depth[0]).toBe(20)
    step()
    expect(physics.contacts.count).toBe(0)
  })

  it('moves a box out of a static box along the axis of the smaller overlap', () => {
    const { body, pos, step } = setup(NO_GRAVITY)
    const box = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'box', width: 20, height: 20 },
    })
    body({
      type: 'static',
      position: { x: 0, y: 18 },
      shape: { kind: 'box', width: 100, height: 20 },
    })
    step()
    expect(pos(box)[0]).toBeCloseTo(0)
    expect(pos(box)[1]).toBeCloseTo(-2)
  })

  it('pushes out a ball whose centre is inside a box', () => {
    const { body, pos, step } = setup(NO_GRAVITY)
    body({
      type: 'static',
      position: { x: 0, y: 0 },
      shape: { kind: 'box', width: 40, height: 20 },
    })
    const ball = body({
      type: 'dynamic',
      position: { x: 0, y: 8 },
      shape: { kind: 'circle', radius: 5 },
    })
    step()
    expect(pos(ball)[0]).toBeCloseTo(0)
    expect(pos(ball)[1]).toBeCloseTo(15)
  })

  it('never resolves two static bodies', () => {
    const { body, pos, step } = setup(NO_GRAVITY)
    const a = body({
      type: 'static',
      position: { x: 0, y: 0 },
      shape: { kind: 'box', width: 20, height: 20 },
    })
    const b = body({
      type: 'static',
      position: { x: 5, y: 0 },
      shape: { kind: 'box', width: 20, height: 20 },
    })
    step()
    expect(pos(a)).toEqual([0, 0])
    expect(pos(b)).toEqual([5, 0])
  })
})

describe('contact records', () => {
  const circle = { kind: 'circle', radius: 10 } as const
  const box = { kind: 'box', width: 20, height: 20 } as const

  /** Two dynamic bodies, 20 wide, whose centres are 15 apart on the x axis. */
  function overlappingPair(
    first: BodyDef['shape'],
    second: BodyDef['shape'],
    maxContacts?: number,
  ) {
    const s = setup(NO_GRAVITY, maxContacts)
    const a = s.body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: first,
    })
    const b = s.body({
      type: 'dynamic',
      position: { x: 15, y: 0 },
      shape: second,
    })
    return { ...s, a, b }
  }

  it('records the two ids, the normal, the overlap and the impulse', () => {
    const { ballId, physics, step } = ballOnFloor()
    step()
    const c = physics.contacts
    expect(c.count).toBe(1)
    expect(c.dropped).toBe(0)
    expect(c.a[0]).toBe(0)
    expect(c.b[0]).toBe(ballId)
    expect([c.nx[0], c.ny[0]]).toEqual([0, -1])
    expect(c.depth[0]).toBeCloseTo(5)
    const ballMass = Math.PI * 10 * 10
    expect(c.impulse[0] / (600 * ballMass)).toBeCloseTo(1, 5)
  })

  it.each([
    ['circle', 'circle', circle, circle],
    ['circle', 'box', circle, box],
    ['box', 'circle', box, circle],
    ['box', 'box', box, box],
  ])(
    'points the normal from the lower id to the higher id: %s, then %s',
    (_first, _second, first, second) => {
      const { a, b, physics, step } = overlappingPair(first, second)
      step()
      const c = physics.contacts
      expect(c.count).toBe(1)
      expect(c.a[0]).toBe(a)
      expect(c.b[0]).toBe(b)
      expect(c.nx[0]).toBe(1)
      expect(c.ny[0]).toBeCloseTo(0)
      expect(c.depth[0]).toBeCloseTo(5)
    },
  )

  it('keeps the lower id first when the static body has the higher id', () => {
    const { body, physics, step } = setup(NO_GRAVITY)
    const ball = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 600 },
      shape: circle,
    })
    const floor = body({
      type: 'static',
      position: { x: 0, y: 25 },
      shape: { kind: 'box', width: 200, height: 20 },
    })
    step()
    const c = physics.contacts
    expect(c.a[0]).toBe(ball)
    expect(c.b[0]).toBe(floor)
    expect(c.nx[0]).toBeCloseTo(0)
    expect(c.ny[0]).toBe(1)
  })

  it('gives no impulse to two bodies that already move apart', () => {
    const { a, b, Velocity, physics, step } = overlappingPair(circle, circle)
    Velocity.data.x[a] = -60
    Velocity.data.x[b] = 60
    step()
    expect(physics.contacts.count).toBe(1)
    expect(physics.contacts.impulse[0]).toBe(0)
  })

  it('starts each step with no records', () => {
    const { physics, step } = ballOnFloor(
      { restitution: 1 },
      { restitution: 1 },
    )
    step()
    expect(physics.contacts.count).toBe(1)
    step()
    expect(physics.contacts.count).toBe(0)
  })

  it('records nothing for two static bodies', () => {
    const { body, physics, step } = setup(NO_GRAVITY)
    body({ type: 'static', position: { x: 0, y: 0 }, shape: box })
    body({ type: 'static', position: { x: 5, y: 0 }, shape: box })
    step()
    expect(physics.contacts.count).toBe(0)
  })

  it('resolves a contact that does not fit, and counts it as dropped', () => {
    const { body, physics, pos, step } = overlappingPair(circle, circle, 1)
    const c = body({
      type: 'dynamic',
      position: { x: 100, y: 0 },
      shape: circle,
    })
    const d = body({
      type: 'dynamic',
      position: { x: 115, y: 0 },
      shape: circle,
    })
    step()
    expect(physics.contacts.count).toBe(1)
    expect(physics.contacts.dropped).toBe(1)
    expect(pos(d)[0] - pos(c)[0]).toBeCloseTo(20)
    step()
    expect(physics.contacts.dropped).toBe(0)
  })

  it('has room for 2 contacts for each entity when no size is given', () => {
    const { world, physics } = setup()
    expect(physics.contacts.a.length).toBe(2 * world.capacity)
  })

  it.each([0, -1, 1.5])('refuses %s as the size of the buffer', (size) => {
    expect(() => setup(NO_GRAVITY, size)).toThrow(
      'maxContacts must be a positive integer',
    )
  })

  it('clears the records on destroy', () => {
    const { physics, step } = ballOnFloor()
    step()
    physics.destroy()
    expect(physics.contacts.count).toBe(0)
  })
})

describe('sensors', () => {
  const box = { kind: 'box', width: 20, height: 20 } as const

  it('lets a ball go through a static sensor, and records the contact', () => {
    const { ballId, physics, pos, vel, step } = ballOnFloor(
      {},
      { sensor: true },
    )
    step()
    expect(pos(ballId)).toEqual([0, 10])
    expect(vel(ballId)).toEqual([0, 600])
    const c = physics.contacts
    expect(c.count).toBe(1)
    expect(c.sensor[0]).toBe(1)
    expect(c.depth[0]).toBeCloseTo(5)
    expect(c.impulse[0]).toBe(0)
  })

  it('lets a dynamic sensor go through a static body', () => {
    const { ballId, physics, pos, vel, step } = ballOnFloor({ sensor: true })
    step()
    expect(pos(ballId)).toEqual([0, 10])
    expect(vel(ballId)).toEqual([0, 600])
    expect(physics.contacts.sensor[0]).toBe(1)
  })

  it('records two dynamic sensors that overlap, and moves neither', () => {
    const { body, physics, pos, step } = setup(NO_GRAVITY)
    const a = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: box,
      sensor: true,
    })
    const b = body({
      type: 'dynamic',
      position: { x: 15, y: 0 },
      shape: box,
      sensor: true,
    })
    step()
    expect(pos(a)).toEqual([0, 0])
    expect(pos(b)).toEqual([15, 0])
    expect(physics.contacts.count).toBe(1)
    expect(physics.contacts.sensor[0]).toBe(1)
  })

  it('marks a contact of two solid bodies as not a sensor', () => {
    const { physics, step } = ballOnFloor()
    step()
    expect(physics.contacts.sensor[0]).toBe(0)
  })

  it('reports the same contact in each step that the overlap lasts', () => {
    const { physics, step } = ballOnFloor({}, { sensor: true })
    step()
    step()
    expect(physics.contacts.count).toBe(1)
  })

  it('never tests a static sensor against a static body', () => {
    const { body, physics, step } = setup(NO_GRAVITY)
    body({ type: 'static', position: { x: 0, y: 0 }, shape: box, sensor: true })
    body({ type: 'static', position: { x: 5, y: 0 }, shape: box })
    step()
    expect(physics.contacts.count).toBe(0)
  })

  it('makes the body solid again when a new attach has no sensor', () => {
    const { ballId, physics, vel, step } = ballOnFloor({ sensor: true })
    expect(physics.body.data.flags[ballId]).toBe(1)
    physics.attach(ballId, {
      type: 'dynamic',
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 600 },
      shape: { kind: 'circle', radius: 10 },
    })
    expect(physics.body.data.flags[ballId]).toBe(0)
    step()
    expect(vel(ballId)[1]).toBeCloseTo(0)
  })
})

describe('body lifecycle', () => {
  it('stops the simulation of a detached body', () => {
    const { body, physics, pos, step } = setup()
    const id = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 1 },
    })
    step()
    const before = pos(id)
    physics.detach(id)
    step()
    expect(pos(id)).toEqual(before)
  })

  it('skips a destroyed entity, and gives its reused id no body', () => {
    const { world, Position, Velocity, body, vel, step } = setup()
    const id = body({
      type: 'dynamic',
      position: { x: 0, y: 0 },
      shape: { kind: 'circle', radius: 1 },
    })
    destroyEntity(world, id)
    step()
    const reused = createEntity(world)
    expect(reused).toBe(id)
    addComponent(world, reused, Position)
    addComponent(world, reused, Velocity)
    step()
    expect(vel(reused)).toEqual([0, 0])
  })
})
