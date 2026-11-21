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
    time: { current: 0, previous: 0, delta, alpha: 1 },
    input: { touches: [], pointers: [] },
    screen: { width: 0, height: 0 },
    events: [],
    dispatch: () => {},
  }
}

function setup(gravity?: PhysicsOptions['gravity']) {
  const world = createWorld({ capacity: 16 })
  const Position = defineComponent(world, { x: 'f32', y: 'f32' })
  const Velocity = defineComponent(world, { x: 'f32', y: 'f32' })
  const physics = createPhysics({
    world,
    position: Position,
    velocity: Velocity,
    gravity,
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
