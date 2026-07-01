import {
  addComponent,
  createEntity,
  createPhysics,
  createWorld,
  defineComponent,
  destroyEntity,
  type Component,
  type Physics,
  type System,
  type World,
} from '@rootnative/game-engine';
import { type SkiaAtlas } from '@rootnative/game-engine/renderers/skia';

import { buildAtlases } from './atlases';
import {
  makeBallBounds,
  makeBallBrickCollision,
  makeBallSpeedClamp,
  makeInputHandler,
  makePaddleControl,
  type BuildFns,
} from './systems';

export {
  ATLAS_BALL,
  ATLAS_PADDLE,
  ATLAS_BRICK,
  BALL_RADIUS,
  BALL_SPEED,
  BRICK_COLS,
  BRICK_GAP,
  BRICK_H,
  BRICK_ROWS,
  BRICK_TOP,
  BRICK_W,
  PADDLE_BOTTOM_OFFSET,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
} from './constants';

import {
  ATLAS_BALL,
  ATLAS_BRICK,
  ATLAS_PADDLE,
  BALL_RADIUS,
  BALL_SPEED,
  BRICK_COLS,
  BRICK_GAP,
  BRICK_H,
  BRICK_ROWS,
  BRICK_TOP,
  BRICK_W,
  PADDLE_BOTTOM_OFFSET,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  WALL,
} from './constants';

export type PositionComponent = Component<{ x: 'f32'; y: 'f32' }>;
export type VelocityComponent = Component<{ x: 'f32'; y: 'f32' }>;
export type SpriteComponent = Component<{ atlas: 'u32'; frame: 'u16'; tint: 'u32' }>;
export type BrickComponent = Component<{ _: 'u8' }>;
export type PaddleComponent = Component<{ _: 'u8' }>;
export type BallComponent = Component<{ _: 'u8' }>;

export interface LevelRefs {
  paddleId: number;
  ballId: number;
  screenW: number;
  screenH: number;
}

export interface LevelDeps {
  readonly world: World;
  readonly Position: PositionComponent;
  readonly Velocity: VelocityComponent;
  readonly Sprite: SpriteComponent;
  readonly Brick: BrickComponent;
  readonly Paddle: PaddleComponent;
  readonly Ball: BallComponent;
  readonly physics: Physics;
  readonly refs: LevelRefs;
  readonly onRestart: () => void;
}

export interface Level {
  readonly world: World;
  readonly systems: ReadonlyArray<System>;
  readonly atlases: ReadonlyArray<SkiaAtlas>;
  readonly Position: PositionComponent;
  readonly Sprite: SpriteComponent;
}

export interface LoadLevelOptions {
  readonly onRestart: () => void;
}

export async function loadLevel(opts: LoadLevelOptions): Promise<Level> {
  const world = createWorld({ capacity: 1024 });
  const Position = defineComponent(world, { x: 'f32', y: 'f32' });
  const Velocity = defineComponent(world, { x: 'f32', y: 'f32' });
  const Sprite = defineComponent(world, { atlas: 'u32', frame: 'u16', tint: 'u32' });
  const Brick = defineComponent(world, { _: 'u8' });
  const Paddle = defineComponent(world, { _: 'u8' });
  const Ball = defineComponent(world, { _: 'u8' });

  const physics = createPhysics({
    world,
    position: Position,
    velocity: Velocity,
    gravity: { x: 0, y: 0 },
  });

  const refs: LevelRefs = { paddleId: -1, ballId: -1, screenW: 0, screenH: 0 };

  const deps: LevelDeps = {
    world,
    Position,
    Velocity,
    Sprite,
    Brick,
    Paddle,
    Ball,
    physics,
    refs,
    onRestart: opts.onRestart,
  };

  const builders = makeBuilders(deps);

  const systems: ReadonlyArray<System> = [
    makeInputHandler(deps, builders),
    makePaddleControl(deps),
    physics.step,
    makeBallSpeedClamp(deps),
    makeBallBrickCollision(deps),
    makeBallBounds(deps, builders),
  ];

  const atlases = buildAtlases();

  return { world, systems, atlases, Position, Sprite };
}

function makeBuilders(deps: LevelDeps): BuildFns {
  const { world, Position, Velocity, Sprite, Brick, Paddle, Ball, physics, refs } = deps;

  function clearLevel(): void {
    for (let id = 0; id < world.nextId; id++) {
      if (world.alive[id] === 1) destroyEntity(world, id);
    }
    refs.paddleId = -1;
    refs.ballId = -1;
  }

  function spawnWall(cx: number, cy: number, w: number, h: number): void {
    const id = createEntity(world);
    physics.attach(id, {
      type: 'static',
      position: { x: cx, y: cy },
      shape: { kind: 'box', width: w, height: h },
      restitution: 1,
      friction: 0,
    });
  }

  function spawnPaddle(screenW: number, screenH: number): number {
    const id = createEntity(world);
    physics.attach(id, {
      type: 'static',
      position: { x: screenW / 2, y: screenH - PADDLE_BOTTOM_OFFSET },
      shape: { kind: 'box', width: PADDLE_WIDTH, height: PADDLE_HEIGHT },
      restitution: 1,
      friction: 0.4,
    });
    addComponent(world, id, Sprite, { atlas: ATLAS_PADDLE, frame: 0, tint: 0 });
    addComponent(world, id, Paddle, { _: 1 });
    return id;
  }

  function spawnBall(screenW: number, screenH: number): number {
    const id = createEntity(world);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3);
    physics.attach(id, {
      type: 'dynamic',
      position: { x: screenW / 2, y: screenH - PADDLE_BOTTOM_OFFSET - 40 },
      velocity: { x: Math.cos(angle) * BALL_SPEED, y: Math.sin(angle) * BALL_SPEED },
      shape: { kind: 'circle', radius: BALL_RADIUS },
      restitution: 1,
      friction: 0,
      mass: 1,
    });
    addComponent(world, id, Sprite, { atlas: ATLAS_BALL, frame: 0, tint: 0 });
    addComponent(world, id, Ball, { _: 1 });
    return id;
  }

  function spawnBricks(screenW: number): number {
    const totalW = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP;
    const startX = (screenW - totalW) / 2 + BRICK_W / 2;
    let count = 0;
    for (let r = 0; r < BRICK_ROWS; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        const id = createEntity(world);
        const x = startX + c * (BRICK_W + BRICK_GAP);
        const y = BRICK_TOP + r * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
        physics.attach(id, {
          type: 'static',
          position: { x, y },
          shape: { kind: 'box', width: BRICK_W, height: BRICK_H },
          restitution: 1,
          friction: 0,
        });
        addComponent(world, id, Sprite, { atlas: ATLAS_BRICK, frame: r, tint: 0 });
        addComponent(world, id, Brick, { _: 1 });
        count++;
      }
    }
    return count;
  }

  function buildLevel(screenW: number, screenH: number): { bricksLeft: number } {
    clearLevel();
    refs.screenW = screenW;
    refs.screenH = screenH;

    spawnWall(screenW / 2, -WALL / 2, screenW + WALL * 2, WALL);
    spawnWall(-WALL / 2, screenH / 2, WALL, screenH * 2);
    spawnWall(screenW + WALL / 2, screenH / 2, WALL, screenH * 2);

    refs.paddleId = spawnPaddle(screenW, screenH);
    refs.ballId = spawnBall(screenW, screenH);
    const bricksLeft = spawnBricks(screenW);
    return { bricksLeft };
  }

  function resetBall(): void {
    if (refs.ballId < 0 || refs.paddleId < 0) return;
    const px = Position.data.x[refs.paddleId];
    const py = Position.data.y[refs.paddleId];
    Position.data.x[refs.ballId] = px;
    Position.data.y[refs.ballId] = py - 40;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3);
    Velocity.data.x[refs.ballId] = Math.cos(angle) * BALL_SPEED;
    Velocity.data.y[refs.ballId] = Math.sin(angle) * BALL_SPEED;
  }

  return { buildLevel, resetBall };
}
