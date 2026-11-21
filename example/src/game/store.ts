import { useSyncExternalStore } from 'react'

export type GameStatus = 'ready' | 'playing' | 'won' | 'lost'

export interface GameState {
  readonly score: number
  readonly lives: number
  readonly bricksLeft: number
  readonly status: GameStatus
}

const INITIAL: GameState = {
  score: 0,
  lives: 3,
  bricksLeft: 0,
  status: 'ready',
}

let state: GameState = INITIAL
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export const gameStore = {
  get(): GameState {
    return state
  },
  set(patch: Partial<GameState>): void {
    const next = { ...state, ...patch }
    if (
      next.score === state.score &&
      next.lives === state.lives &&
      next.bricksLeft === state.bricksLeft &&
      next.status === state.status
    ) {
      return
    }
    state = next
    emit()
  },
  reset(patch?: Partial<GameState>): void {
    state = { ...INITIAL, ...patch }
    emit()
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

export function useGameState(): GameState {
  return useSyncExternalStore(gameStore.subscribe, gameStore.get, gameStore.get)
}
