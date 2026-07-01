import { Skia, type SkImage } from '@shopify/react-native-skia';
import { gridFrames, type SkiaAtlas } from '@rootnative/game-engine/renderers/skia';

import { BALL_RADIUS, BRICK_H, BRICK_W, PADDLE_HEIGHT, PADDLE_WIDTH } from './constants';

const BRICK_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6'];

function makeCircleImage(radius: number, color: string): SkImage | null {
  const size = radius * 2;
  const surface = Skia.Surface.Make(size, size);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  paint.setAntiAlias(true);
  canvas.drawCircle(radius, radius, radius - 0.5, paint);
  return surface.makeImageSnapshot();
}

function makeRoundedRectImage(
  width: number,
  height: number,
  color: string,
  radius = 4,
): SkImage | null {
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(color));
  paint.setAntiAlias(true);
  const rrect = Skia.RRectXY(Skia.XYWHRect(0, 0, width, height), radius, radius);
  canvas.drawRRect(rrect, paint);
  return surface.makeImageSnapshot();
}

function makeBrickAtlasImage(): SkImage | null {
  const surface = Skia.Surface.Make(BRICK_W, BRICK_H * BRICK_COLORS.length);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  for (let i = 0; i < BRICK_COLORS.length; i++) {
    paint.setColor(Skia.Color(BRICK_COLORS[i]));
    const rrect = Skia.RRectXY(Skia.XYWHRect(0, i * BRICK_H, BRICK_W, BRICK_H), 3, 3);
    canvas.drawRRect(rrect, paint);
  }
  return surface.makeImageSnapshot();
}

export function buildAtlases(): ReadonlyArray<SkiaAtlas> {
  const ball = makeCircleImage(BALL_RADIUS, '#111827');
  const paddle = makeRoundedRectImage(PADDLE_WIDTH, PADDLE_HEIGHT, '#1f2937', 6);
  const bricks = makeBrickAtlasImage();
  return [
    {
      image: ball,
      frames: [{ x: 0, y: 0, width: BALL_RADIUS * 2, height: BALL_RADIUS * 2 }],
    },
    {
      image: paddle,
      frames: [{ x: 0, y: 0, width: PADDLE_WIDTH, height: PADDLE_HEIGHT }],
    },
    {
      image: bricks,
      frames: gridFrames({
        frameWidth: BRICK_W,
        frameHeight: BRICK_H,
        columns: 1,
        rows: BRICK_COLORS.length,
      }),
    },
  ];
}
