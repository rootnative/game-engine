import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLoop, createWorld } from '../src/core'
import type { LoopOptions, System, TouchEvent } from '../src/core'

// 50 Hz gives a step of exactly 20 ms, so the step counts are exact.
const HZ = 50
const STEP = 20

// The loop reads the wall clock from `performance.now()` and schedules each
// tick with `setTimeout`. The tests set the clock by hand and fake only the
// timers. So each tick sees the exact wall time that the test gives, and a
// test can make a freeze: a long gap with no tick.
let wall = 0

beforeEach(() => {
  wall = 0
  vi.spyOn(performance, 'now').mockImplementation(() => wall)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Moves the wall clock, then runs the tick that the loop scheduled. */
function advance(ms: number): void {
  wall += ms
  vi.runOnlyPendingTimers()
}

function setup(systems: System[], options: LoopOptions = {}) {
  const world = createWorld({ capacity: 1 })
  const loop = createLoop(world, systems, { hz: HZ, ...options })
  return { world, loop }
}

function touch(type: TouchEvent['type']): TouchEvent {
  return { id: 0, type, x: 0, y: 0, t: 0 }
}

describe('createLoop timing', () => {
  it('runs no step at the start', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system])
    loop.start()
    expect(loop.isRunning()).toBe(true)
    expect(system).not.toHaveBeenCalled()
  })

  it('runs one step for each full step of wall time, and keeps the rest', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system])
    loop.start()
    advance(STEP * 3 + 5)
    expect(system).toHaveBeenCalledTimes(3)
    advance(STEP - 5)
    expect(system).toHaveBeenCalledTimes(4)
  })

  it('gives each step the fixed delta, and moves the sim time by it', () => {
    const times: Array<{ previous: number; current: number; delta: number }> =
      []
    const { loop } = setup([
      (_world, ctx) => {
        const { previous, current, delta } = ctx.time
        times.push({ previous, current, delta })
      },
    ])
    loop.start()
    advance(STEP * 2)
    expect(times).toHaveLength(2)
    expect(times[0].previous).toBe(0)
    expect(times[0].current).toBeCloseTo(1 / HZ)
    expect(times[1].previous).toBeCloseTo(1 / HZ)
    expect(times[1].current).toBeCloseTo(2 / HZ)
    for (const t of times) expect(t.delta).toBeCloseTo(1 / HZ)
  })

  it('runs one step after a gap longer than maxCatchUpMs', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system])
    loop.start()
    advance(1000)
    expect(system).toHaveBeenCalledTimes(1)
  })

  it('catches up in full after a gap of maxCatchUpMs or less', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system])
    loop.start()
    advance(240)
    expect(system).toHaveBeenCalledTimes(12)
  })

  it('takes maxCatchUpMs from the options', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system], { maxCatchUpMs: 100 })
    loop.start()
    advance(120)
    expect(system).toHaveBeenCalledTimes(1)
    advance(100)
    expect(system).toHaveBeenCalledTimes(6)
  })
})

describe('createLoop input and events', () => {
  it('shows a touch to one step only', () => {
    const seen: number[] = []
    const { loop } = setup([
      (_world, ctx) => {
        seen.push(ctx.input.touches.length)
      },
    ])
    loop.start()
    loop.pushTouch(touch('tap'))
    advance(STEP * 2)
    expect(seen).toEqual([1, 0])
  })

  it('keeps a touch until the next step', () => {
    const seen: string[][] = []
    const { loop } = setup([
      (_world, ctx) => {
        seen.push(ctx.input.touches.map((t) => t.type))
      },
    ])
    loop.start()
    loop.pushTouch(touch('start'))
    advance(STEP / 2)
    loop.pushTouch(touch('end'))
    expect(seen).toEqual([])
    advance(STEP / 2)
    expect(seen).toEqual([['start', 'end']])
  })

  it('shows an event from outside to each system of the next step, then drops it', () => {
    const seenA: string[][] = []
    const seenB: string[][] = []
    const { loop } = setup([
      (_world, ctx) => {
        seenA.push(ctx.events.map((e) => e.type))
      },
      (_world, ctx) => {
        seenB.push(ctx.events.map((e) => e.type))
      },
    ])
    loop.start()
    loop.dispatch({ type: 'hit' })
    advance(STEP * 2)
    expect(seenA).toEqual([['hit'], []])
    expect(seenB).toEqual([['hit'], []])
  })

  it('shows an event from a system to the later systems of the same step only', () => {
    const seenA: string[][] = []
    const seenB: string[][] = []
    const { loop } = setup([
      (_world, ctx) => {
        seenA.push(ctx.events.map((e) => e.type))
        if (seenA.length === 1) ctx.dispatch({ type: 'spawned' })
      },
      (_world, ctx) => {
        seenB.push(ctx.events.map((e) => e.type))
      },
    ])
    loop.start()
    advance(STEP * 2)
    expect(seenA).toEqual([[], []])
    expect(seenB).toEqual([['spawned'], []])
  })

  it('gives the systems the screen size', () => {
    const sizes: Array<[number, number]> = []
    const { loop } = setup([
      (_world, ctx) => {
        sizes.push([ctx.screen.width, ctx.screen.height])
      },
    ])
    loop.setScreen(320, 640)
    loop.start()
    advance(STEP)
    expect(sizes).toEqual([[320, 640]])
  })
})

describe('createLoop lifecycle', () => {
  it('runs no step while paused, and does not catch up the paused time', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system])
    loop.start()
    advance(STEP)
    loop.pause()
    expect(loop.isPaused()).toBe(true)
    advance(STEP * 5)
    expect(system).toHaveBeenCalledTimes(1)
    loop.resume()
    expect(loop.isPaused()).toBe(false)
    expect(system).toHaveBeenCalledTimes(1)
    advance(STEP)
    expect(system).toHaveBeenCalledTimes(2)
  })

  it('runs no step after stop, and leaves no timer', () => {
    const system = vi.fn<System>()
    const { loop } = setup([system])
    loop.start()
    advance(STEP)
    loop.stop()
    expect(loop.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    advance(STEP * 3)
    expect(system).toHaveBeenCalledTimes(1)
  })

  it('runs the new world and systems from the next step, and drops the pending input', () => {
    const first = vi.fn<System>()
    const pending: Array<[number, number]> = []
    const second = vi.fn<System>((_world, ctx) => {
      pending.push([ctx.input.touches.length, ctx.events.length])
    })
    const { loop } = setup([first])
    const next = createWorld({ capacity: 1 })
    loop.start()
    loop.pushTouch(touch('tap'))
    loop.dispatch({ type: 'old' })
    loop.swap(next, [second])
    advance(STEP)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0][0]).toBe(next)
    expect(pending).toEqual([[0, 0]])
  })

  it('resets the accumulator on a swap', () => {
    const system = vi.fn<System>()
    const { loop, world } = setup([system])
    loop.start()
    advance(STEP - 5)
    loop.swap(world, [system])
    advance(10)
    expect(system).not.toHaveBeenCalled()
    advance(STEP - 10)
    expect(system).toHaveBeenCalledTimes(1)
  })

  it('calls an after-step listener once for each tick that ran a step', () => {
    const listener = vi.fn()
    const { loop } = setup([])
    const unsubscribe = loop.onAfterStep(listener)
    loop.start()
    advance(STEP * 3)
    expect(listener).toHaveBeenCalledTimes(1)
    advance(STEP / 2)
    expect(listener).toHaveBeenCalledTimes(1)
    advance(STEP / 2)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    advance(STEP)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
