import type {
  FrameContext,
  GameEvent,
  Pointer,
  System,
  TouchEvent,
  World,
} from './types'

export interface LoopOptions {
  readonly hz?: number
  readonly maxCatchUpMs?: number
}

export interface Loop {
  readonly start: () => void
  readonly stop: () => void
  readonly pause: () => void
  readonly resume: () => void
  readonly isRunning: () => boolean
  readonly isPaused: () => boolean
  readonly swap: (world: World, systems: ReadonlyArray<System>) => void
  readonly setScreen: (width: number, height: number) => void
  readonly dispatch: (e: GameEvent) => void
  readonly pushTouch: (e: TouchEvent) => void
  readonly onAfterStep: (cb: () => void) => () => void
}

type MutablePointer = { -readonly [K in keyof Pointer]: Pointer[K] }

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

export function createLoop(
  world: World,
  systems: ReadonlyArray<System>,
  opts: LoopOptions = {},
): Loop {
  const hz = opts.hz ?? 60
  const stepMs = 1000 / hz
  const stepS = 1 / hz
  const maxCatchUpMs = opts.maxCatchUpMs ?? 250

  let currentWorld = world
  let currentSystems = systems

  const ctx = {
    time: { current: 0, previous: 0, delta: stepS },
    input: { touches: [] as TouchEvent[], pointers: [] as MutablePointer[] },
    screen: { width: 0, height: 0 },
    events: [] as GameEvent[],
    dispatch(e: GameEvent) {
      ctx.events.push(e)
    },
  }
  const externalCtx: FrameContext = ctx

  let running = false
  let paused = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastWall = 0
  let acc = 0
  const afterStep: Array<() => void> = []

  // The pointer state changes when a touch arrives, not when a step reads
  // it. So a step sees the state after its touches, and a swap, which drops
  // the queued touches, keeps the state of a finger that is still down.
  const trackPointer = (e: TouchEvent): void => {
    const pointers = ctx.input.pointers
    let pointer: MutablePointer | undefined
    for (let i = 0; i < pointers.length; i++) {
      if (pointers[i].id === e.id) {
        pointer = pointers[i]
        break
      }
    }
    if (pointer === undefined) {
      pointer = { id: e.id, x: 0, y: 0, down: false }
      pointers.push(pointer)
    }
    pointer.x = e.x
    pointer.y = e.y
    pointer.down = e.type !== 'end'
  }

  const step = (): void => {
    ctx.time.previous = ctx.time.current
    ctx.time.current += stepS
    const sys = currentSystems
    for (let i = 0; i < sys.length; i++) {
      sys[i](currentWorld, externalCtx)
    }
    ctx.events.length = 0
    ctx.input.touches.length = 0
  }

  const tick = (): void => {
    if (!running || paused) return
    const wall = now()
    let delta = wall - lastWall
    lastWall = wall
    if (delta > maxCatchUpMs) delta = stepMs
    acc += delta
    let stepped = false
    while (acc >= stepMs) {
      step()
      acc -= stepMs
      stepped = true
    }
    if (stepped) {
      for (let i = 0; i < afterStep.length; i++) afterStep[i]()
    }
    if (running && !paused) {
      timeoutId = setTimeout(tick, Math.max(0, stepMs - acc))
    }
  }

  return {
    start(): void {
      if (running) return
      running = true
      paused = false
      lastWall = now()
      acc = 0
      tick()
    },
    stop(): void {
      running = false
      paused = false
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
    pause(): void {
      if (!running || paused) return
      paused = true
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
    resume(): void {
      if (!running || !paused) return
      paused = false
      lastWall = now()
      acc = 0
      tick()
    },
    isRunning: () => running,
    isPaused: () => paused,
    swap(nextWorld, nextSystems): void {
      currentWorld = nextWorld
      currentSystems = nextSystems
      acc = 0
      ctx.events.length = 0
      ctx.input.touches.length = 0
    },
    setScreen(width, height): void {
      ctx.screen.width = width
      ctx.screen.height = height
    },
    dispatch(e): void {
      ctx.events.push(e)
    },
    pushTouch(e): void {
      ctx.input.touches.push(e)
      if (e.type === 'start' || e.type === 'move' || e.type === 'end') {
        trackPointer(e)
      }
    },
    onAfterStep(cb): () => void {
      afterStep.push(cb)
      return () => {
        const i = afterStep.indexOf(cb)
        if (i >= 0) afterStep.splice(i, 1)
      }
    },
  }
}
