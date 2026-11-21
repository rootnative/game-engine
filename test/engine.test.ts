import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLoop, createWorld } from '../src/core'
import { toEngine } from '../src/engine'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const loop = createLoop(createWorld({ capacity: 1 }), [])
  return { loop, engine: toEngine(loop) }
}

describe('toEngine', () => {
  // The props of <GameEngine> own start, stop, swap and the screen size, and
  // its gestures own pushTouch. A component inside it gets only these.
  it('gives only the controls that a component inside <GameEngine> needs', () => {
    const { engine } = setup()
    expect(Object.keys(engine).sort()).toEqual([
      'dispatch',
      'isPaused',
      'isRunning',
      'onAfterStep',
      'pause',
      'resume',
    ])
  })

  it('pauses and resumes the loop', () => {
    const { loop, engine } = setup()
    loop.start()
    engine.pause()
    expect(loop.isPaused()).toBe(true)
    expect(engine.isPaused()).toBe(true)
    engine.resume()
    expect(loop.isPaused()).toBe(false)
    expect(engine.isRunning()).toBe(true)
    loop.stop()
    expect(engine.isRunning()).toBe(false)
  })
})
