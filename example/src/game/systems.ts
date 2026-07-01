import { destroyEntity, query, type System } from '@rootnative/game-engine';

import {
  BALL_RADIUS,
  BALL_SPEED,
  BRICK_H,
  BRICK_W,
  PADDLE_WIDTH,
} from './constants';
import type { LevelDeps } from '.';
import { gameStore } from './store';

const MIN_HORIZONTAL_FRACTION = 0.2;
const MIN_VERTICAL_FRACTION = 0.2;

export interface BuildFns {
  readonly buildLevel: (screenW: number, screenH: number) => { bricksLeft: number };
  readonly resetBall: () => void;
}

export function makePaddleControl(deps: LevelDeps): System {
  const { Position, Velocity, refs } = deps;
  return (_w, ctx) => {
    if (refs.paddleId < 0) return;
    const screenW = ctx.screen.width || refs.screenW;
    if (screenW <= 0) return;

    let dx = 0;
    let movedThisStep = false;
    for (let i = 0; i < ctx.input.touches.length; i++) {
      const t = ctx.input.touches[i];
      if (t.type === 'move' && t.dx !== undefined) {
        dx += t.dx;
        movedThisStep = true;
      }
    }

    const px = Position.data.x;
    const vx = Velocity.data.x;
    const id = refs.paddleId;
    const halfPaddle = PADDLE_WIDTH / 2;

    if (movedThisStep) {
      const before = px[id];
      let next = before + dx;
      if (next < halfPaddle) next = halfPaddle;
      else if (next > screenW - halfPaddle) next = screenW - halfPaddle;
      px[id] = next;
      const dt = ctx.time.delta;
      vx[id] = dt > 0 ? (next - before) / dt : 0;
    } else {
      vx[id] = 0;
    }
  };
}

export function makeBallBrickCollision(deps: LevelDeps): System {
  const { Position, Brick, refs } = deps;
  return (w, _ctx) => {
    if (refs.ballId < 0) return;
    if (gameStore.get().status !== 'playing') return;

    const bx = Position.data.x[refs.ballId];
    const by = Position.data.y[refs.ballId];
    const r = BALL_RADIUS + 0.75;
    const r2 = r * r;
    const halfW = BRICK_W / 2;
    const halfH = BRICK_H / 2;

    let destroyed = 0;
    query(w, Brick).each((id) => {
      const cx = Position.data.x[id];
      const cy = Position.data.y[id];
      let qx = bx;
      if (qx < cx - halfW) qx = cx - halfW;
      else if (qx > cx + halfW) qx = cx + halfW;
      let qy = by;
      if (qy < cy - halfH) qy = cy - halfH;
      else if (qy > cy + halfH) qy = cy + halfH;
      const ddx = bx - qx;
      const ddy = by - qy;
      if (ddx * ddx + ddy * ddy <= r2) {
        destroyEntity(w, id);
        destroyed++;
      }
    });

    if (destroyed > 0) {
      const s = gameStore.get();
      const bricksLeft = s.bricksLeft - destroyed;
      gameStore.set({
        score: s.score + destroyed * 10,
        bricksLeft,
        status: bricksLeft <= 0 ? 'won' : s.status,
      });
    }
  };
}

export function makeBallBounds(deps: LevelDeps, b: BuildFns): System {
  const { Position, refs } = deps;
  return (_w, ctx) => {
    if (refs.ballId < 0) return;
    const s = gameStore.get();
    if (s.status !== 'playing') return;
    const screenH = ctx.screen.height || refs.screenH;
    if (screenH <= 0) return;
    if (Position.data.y[refs.ballId] - BALL_RADIUS > screenH) {
      const lives = s.lives - 1;
      if (lives <= 0) {
        gameStore.set({ lives: 0, status: 'lost' });
      } else {
        gameStore.set({ lives });
        b.resetBall();
      }
    }
  };
}

const SPEED_TARGET = BALL_SPEED;
const SPEED_TARGET_SQ = SPEED_TARGET * SPEED_TARGET;
const MIN_HORIZONTAL = SPEED_TARGET * MIN_HORIZONTAL_FRACTION;
const MIN_VERTICAL = SPEED_TARGET * MIN_VERTICAL_FRACTION;

export function makeBallSpeedClamp(deps: LevelDeps): System {
  const { Velocity, refs } = deps;
  return (_w, _ctx) => {
    if (refs.ballId < 0) return;
    if (gameStore.get().status !== 'playing') return;
    const id = refs.ballId;
    const vx = Velocity.data.x;
    const vy = Velocity.data.y;
    let x = vx[id];
    let y = vy[id];
    const sq = x * x + y * y;
    if (sq > 0 && Math.abs(sq - SPEED_TARGET_SQ) > 1) {
      const scale = SPEED_TARGET / Math.sqrt(sq);
      x *= scale;
      y *= scale;
    }
    if (Math.abs(x) < MIN_HORIZONTAL) {
      x = x < 0 ? -MIN_HORIZONTAL : MIN_HORIZONTAL;
      const newY2 = SPEED_TARGET_SQ - x * x;
      y = (y < 0 ? -1 : 1) * Math.sqrt(newY2 > 0 ? newY2 : 0);
    } else if (Math.abs(y) < MIN_VERTICAL) {
      // Without this guard, repeated glancing hits on the paddle (friction 0.4)
      // can drain vy until the ball rattles horizontally between the side walls
      // forever, never falling far enough to hit the paddle again.
      y = y < 0 ? -MIN_VERTICAL : MIN_VERTICAL;
      const newX2 = SPEED_TARGET_SQ - y * y;
      x = (x < 0 ? -1 : 1) * Math.sqrt(newX2 > 0 ? newX2 : 0);
    }
    vx[id] = x;
    vy[id] = y;
  };
}

export function makeInputHandler(deps: LevelDeps, b: BuildFns): System {
  const { refs, onRestart } = deps;
  return (_w, ctx) => {
    let tapped = false;
    for (let i = 0; i < ctx.input.touches.length; i++) {
      if (ctx.input.touches[i].type === 'tap') {
        tapped = true;
        break;
      }
    }
    if (!tapped) return;

    const s = gameStore.get();
    if (s.status === 'playing') return;

    const screenW = ctx.screen.width || refs.screenW;
    const screenH = ctx.screen.height || refs.screenH;
    if (screenW <= 0 || screenH <= 0) return;

    if (s.status === 'ready') {
      const info = b.buildLevel(screenW, screenH);
      gameStore.reset({
        status: 'playing',
        bricksLeft: info.bricksLeft,
        lives: 3,
        score: 0,
      });
      return;
    }

    onRestart();
  };
}
