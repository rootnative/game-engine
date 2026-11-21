import type { Loop } from './core/loop'
import type { GameEvent } from './core/types'

/**
 * What `useEngine()` gives a component inside `<GameEngine>`. The props of
 * `<GameEngine>` control the rest of the loop: `running` starts and stops it,
 * and a new `world` or `systems` swaps it.
 */
export interface Engine {
  readonly pause: () => void
  readonly resume: () => void
  readonly isPaused: () => boolean
  readonly isRunning: () => boolean
  readonly dispatch: (e: GameEvent) => void
  readonly onAfterStep: (cb: () => void) => () => void
}

export function toEngine(loop: Loop): Engine {
  return {
    pause: loop.pause,
    resume: loop.resume,
    isPaused: loop.isPaused,
    isRunning: loop.isRunning,
    dispatch: loop.dispatch,
    onAfterStep: loop.onAfterStep,
  }
}
