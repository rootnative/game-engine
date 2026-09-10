#!/usr/bin/env node
// Builds every RootNative Game Engine brand asset from the one geometry
// definition below.
//
// The mark is a flat-shaded octahedron: four triangular faces, each filled with
// one flat tone, meeting at the near vertex. It says what the package is -- an
// engine that shades polygons every frame -- and it is the smallest solid that
// still reads as a solid.
//
// Why not a controller, a d-pad, or a play triangle. Those say "a game", and
// this package is not a game. It is the renderer under one. A shaded mesh
// primitive is the thing the engine actually produces.
//
// Why an octahedron and not a cube. The sibling `rootnative/ui` repo already
// owns the isometric cube: quad faces, hexagonal silhouette. This mark has
// triangular faces and a diamond silhouette, so the two do not read as variants
// of each other on the org landing page, where both appear side by side.
//
// This script is the single source of truth. `assets/brand/*`,
// `example/assets/*`, and `example-3d/assets/*` are all generated; edit the
// constants here, re-run, and commit the output.
//
//   pnpm run build:brand
//
// Every raster is drawn by the small renderer in this file rather than by an
// external tool. That follows `ui` and `inertia`, which both started by shelling
// out to macOS QuickLook (`qlmanage`) and shipped two silent defects, because a
// thumbnailer is not a rasterizer:
//
//   1. QuickLook composites onto opaque white, so nothing it emits is ever
//      transparent. The "transparent" favicon and the Android adaptive-icon
//      foreground both came out as solid white tiles.
//   2. It anchors artwork top-left when the requested size exceeds the size it
//      infers, instead of scaling, so a 180 px favicon came out half-size in the
//      corner of its frame.
//
// The mark is four straight-edged triangles, so drawing it directly gives real
// alpha and is exact at every size. Nothing here needs a text renderer: the
// social card is emitted as SVG only, because this repo has no docs site to host
// a rasterized card yet.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BRAND_DIR = path.join(ROOT, 'assets', 'brand')
const EXAMPLE_ASSET_DIRS = ['example', 'example-3d'].map((name) =>
  path.join(ROOT, name, 'assets'),
)

// --- palette -----------------------------------------------------------------
// A face is lit, not translucent. Each of the four visible faces takes one flat,
// fully opaque tone from a four-rung emerald ramp, lit from the upper left.
//
// The tones need real luminance separation between neighbouring rungs. Emerald
// 300 and 400 sit about 0.08 apart in relative luminance and the two upper faces
// did not resolve as separate planes, which is the whole reason a shaded solid
// reads as a solid. These four rungs are roughly 0.17 apart.
//
// Green rather than blue or violet on purpose: `ui` is blue, `inertia` is pink
// into indigo, and `impulse` is violet. A card grid that shows all four marks at
// once needs four hues.
const LIGHT_FACES = {
  upperLeft: '#a7f3d0',
  upperRight: '#34d399',
  lowerLeft: '#059669',
  lowerRight: '#065f46',
}

const DARK_FACES = {
  upperLeft: '#d1fae5',
  upperRight: '#6ee7b7',
  lowerLeft: '#10b981',
  lowerRight: '#047857',
}

// Backdrop for the store icon and the social card. Near-black with a green cast
// rather than pure black, so the mark's lit faces sit on a related ground.
const CANVAS_DARK = '#07100c'

// --- geometry ----------------------------------------------------------------
// A 64-unit canvas. The mark is one octahedron seen from slightly above and in
// front, so exactly four of its eight faces point at the viewer.
//
// Five projected vertices. The sixth, the far equator vertex, is behind the
// solid and is never emitted -- this renderer has no hidden-surface removal, so
// a back face handed to it would paint straight through the front ones.
//
//   TOP     the apex
//   LEFT    the left equator vertex
//   RIGHT   the right equator vertex
//   NEAR    the equator vertex closest to the viewer
//   BOTTOM  the lower apex
//
// NEAR sits BELOW the LEFT-RIGHT line. That offset is what turns the outline
// from a flat rhombus with an X through it into a solid: it is the only cue that
// says the two upper faces slope toward the viewer and the two lower faces slope
// away. At NEAR = LEFT.y the four seams meet in a straight cross and the form
// collapses to a flat rhombus tiled with triangles.
const MARK_VIEWBOX = 64

const TOP = [32, 5]
const LEFT = [6, 30]
const RIGHT = [58, 30]
const NEAR = [32, 37]
const BOTTOM = [32, 59]

/** One flat-filled polygon. `tone` names which rung of the light model it takes. */
function face(points, tone) {
  return { kind: 'poly', points, tone }
}

// The four front-facing triangles, in a fixed order so the emitted SVG is
// stable. They are disjoint -- they meet along shared edges but never overlap --
// which is what lets the rasterizer treat them as one union rather than as a
// paint stack. See `renderMark`.
const MARK_SHAPES = [
  face([TOP, LEFT, NEAR], 'upperLeft'),
  face([TOP, NEAR, RIGHT], 'upperRight'),
  face([LEFT, BOTTOM, NEAR], 'lowerLeft'),
  face([NEAR, BOTTOM, RIGHT], 'lowerRight'),
]

// Below roughly 24 px the four tones muddy into one mid-green and the three
// internal seams stop resolving, so favicons get a two-face reduction: the upper
// half of the silhouette in one tone, the lower half in another, at the widest
// contrast the ramp offers.
//
// This keeps the diamond silhouette and the one seam that carries it -- the
// LEFT-NEAR-RIGHT crease. Both halves are convex kites, so neither needs a
// concave fill rule.
const COMPACT_SHAPES = [
  face([TOP, LEFT, NEAR, RIGHT], 'upperRight'),
  face([LEFT, BOTTOM, RIGHT, NEAR], 'lowerRight'),
]

const FONT_STACK =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

// --- shape maths -------------------------------------------------------------
// A shape exposes the same two things, so the SVG emitter and the rasterizer
// read one description and cannot disagree about where it is:
//
//   covers(s, x, y)  -> is this canvas-space point inside the shape?
//   svgPath(s)       -> the same outline as an SVG `d` attribute
//
// They agree by construction, not by coincidence: both read the same corner
// list, and a triangle has no curve to flatten.

/** Crossing-number point-in-polygon. */
function insidePolygon(px, py, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Prepare a shape for repeated hit-testing: precompute its bounding box so most
 * pixels reject with four comparisons instead of walking every edge.
 */
function prepare(s) {
  const poly = s.points
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ]
  return {
    tone: s.tone,
    box,
    covers: (px, py) =>
      px >= box[0] &&
      px <= box[2] &&
      py >= box[1] &&
      py <= box[3] &&
      insidePolygon(px, py, poly),
  }
}

const round = (n) => Number(n.toFixed(2))

/** The shape as an SVG path `d`. Emits the same corners `covers` tests. */
function svgPath(s) {
  const [first, ...rest] = s.points
  return (
    `M ${round(first[0])} ${round(first[1])} ` +
    rest.map((p) => `L ${round(p[0])} ${round(p[1])}`).join(' ') +
    ` Z`
  )
}

/**
 * Bounding box of the artwork in viewBox units, as the union of every shape's
 * own box. The apex and the lower apex are on different triangles, so nothing
 * short of the union is correct here.
 */
function artworkBounds(shapeList) {
  const boxes = shapeList.map((s) => prepare(s).box)
  return {
    x0: Math.min(...boxes.map((b) => b[0])),
    y0: Math.min(...boxes.map((b) => b[1])),
    x1: Math.max(...boxes.map((b) => b[2])),
    y1: Math.max(...boxes.map((b) => b[3])),
    get width() {
      return this.x1 - this.x0
    },
    get height() {
      return this.y1 - this.y0
    },
  }
}

// --- SVG builders ------------------------------------------------------------
// Faces are flat fills, so there are no `<defs>` and no gradient to keep in step
// with the rasterizer. Each path carries its own `fill`.

function shapes(faces, list, indent = '  ') {
  const paths = list.map(
    (s) => `${indent}  <path d="${svgPath(s)}" fill="${faces[s.tone]}" />`,
  )
  return [`${indent}<g>`, ...paths, `${indent}</g>`].join('\n')
}

/**
 * The mark on its own, transparent, filling the viewBox.
 *
 * `width` / `height` are set as well as `viewBox` because Safari gives an SVG
 * with no intrinsic size a zero width inside an `<img>` that only sets `height`.
 *
 * The artwork is centred by an explicit transform, taken from the same
 * `artworkBounds` the rasterizer measures. Do not drop it in favour of trusting
 * the raw coordinates: `renderMark` re-centres on the measured bounds, so a
 * shape table that is off-centre in viewBox space still yields correct PNGs
 * while every SVG consumer gets the mark visibly adrift.
 */
function markSvg({ faces, shapeList, note, size = MARK_VIEWBOX }) {
  const bounds = artworkBounds(shapeList)
  const dx = MARK_VIEWBOX / 2 - (bounds.x0 + bounds.x1) / 2
  const dy = MARK_VIEWBOX / 2 - (bounds.y0 + bounds.y1) / 2
  const centred = round(dx) !== 0 || round(dy) !== 0

  return [
    note ? `<!--\n${note}\n-->` : null,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}" fill="none" role="img" aria-label="RootNative Game Engine">`,
    `  <title>RootNative Game Engine</title>`,
    centred ? `  <g transform="translate(${round(dx)} ${round(dy)})">` : null,
    shapes(faces, shapeList, centred ? '    ' : '  '),
    centred ? `  </g>` : null,
    `</svg>`,
    ``,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

/**
 * Open Graph / Twitter card: mark, wordmark, tagline, package name.
 *
 * Emitted as SVG only. `ui` and `inertia` also ship a PNG of theirs, rasterized
 * through QuickLook because a card needs a text renderer, and both hang that
 * PNG on their Docusaurus site. This repo has no docs site, so there is nowhere
 * for the raster to go and no reason to depend on a macOS binary to make it.
 * Add the raster step alongside the docs site, not before it.
 */
function socialCardSvg() {
  // The card's mark is the same geometry and the same flat tones as every other
  // output. It takes the lighter palette, because the card canvas is dark.
  const cardMark = shapes(DARK_FACES, MARK_SHAPES, '      ')

  // The card's own gradients are card chrome -- the footer rule and the corner
  // glow -- not part of the mark.
  return `<!--
  Open Graph / Twitter card, ${CARD_WIDTH}x${CARD_HEIGHT}. Generated by scripts/build-brand.mjs.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" fill="none">
  <title>RootNative Game Engine — a 2D and 3D game engine for React Native that runs in Expo Go</title>
  <defs>
    <linearGradient id="cardBar" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${CARD_WIDTH}" y2="0">
      <stop offset="0" stop-color="${DARK_FACES.upperLeft}" />
      <stop offset="0.55" stop-color="${DARK_FACES.upperRight}" />
      <stop offset="1" stop-color="${DARK_FACES.lowerLeft}" />
    </linearGradient>
    <radialGradient id="cardGlow" gradientUnits="userSpaceOnUse" cx="1020" cy="110" r="560">
      <stop offset="0" stop-color="${LIGHT_FACES.lowerLeft}" stop-opacity="0.34" />
      <stop offset="0.55" stop-color="${LIGHT_FACES.upperRight}" stop-opacity="0.09" />
      <stop offset="1" stop-color="${CANVAS_DARK}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${CANVAS_DARK}" />
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#cardGlow)" />
  <rect y="${CARD_HEIGHT - 5}" width="${CARD_WIDTH}" height="5" fill="url(#cardBar)" />

  <g transform="translate(96 82) scale(3.1)">
${cardMark}
  </g>

  <text x="110" y="392" font-family="${FONT_STACK}" font-size="86" font-weight="800" letter-spacing="-3" fill="#fafafa">Game Engine</text>
  <text x="110" y="448" font-family="${FONT_STACK}" font-size="34" font-weight="500" fill="#a1a1aa">2D and 3D games for React Native, inside Expo Go</text>
  <text x="110" y="524" font-family="${FONT_STACK}" font-size="26" font-weight="500" letter-spacing="0.4" fill="#71717a">@rootnative/game-engine</text>
</svg>
`
}

// --- rasterization -----------------------------------------------------------

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

// Samples per axis for anti-aliasing; 4 gives 16 per pixel, which is smooth at
// 16 px and still fast enough at 1024 px.
const AA = 4

/**
 * Draw the mark to an RGBA PNG.
 *
 * `scale` is the fraction of the canvas the artwork's bounding box fills, so it
 * means the same thing at every size and is what sets each slot's padding: a
 * favicon wants almost the whole frame, an Android adaptive foreground has to
 * stay inside the 66% safe circle. `background` makes the canvas opaque;
 * omitting it leaves genuine transparency.
 *
 * The faces are composited as a UNION, not as a source-over paint stack: a pixel
 * sums its coverage across every face, mixes the tones in proportion to that
 * coverage, and takes `min(1, total)` as its alpha.
 *
 * That matters here and it did not in `ui` or `inertia`, because this mark has
 * three internal seams that meet at one point. Under source-over, two adjacent
 * faces each cover about half of a seam pixel, so the pixel ends up at
 * 0.5 + 0.5 * 0.5 = 0.75 alpha -- a 25%-transparent hairline along every seam,
 * and a visible transparent cross where the three of them meet. The union rule
 * gives that pixel full alpha and the average of the two tones, which is what a
 * solid object looks like. It is only correct because the faces never overlap.
 */
function renderMark({ shapeList, faces, size, scale = 1, background = null }) {
  const bounds = artworkBounds(shapeList)
  const unit = (size * scale) / Math.max(bounds.width, bounds.height)
  const originX = size / 2 - ((bounds.x0 + bounds.x1) / 2) * unit
  const originY = size / 2 - ((bounds.y0 + bounds.y1) / 2) * unit

  const toUnitX = (deviceX) => (deviceX - originX) / unit
  const toUnitY = (deviceY) => (deviceY - originY) / unit

  // Prepare each shape once, not per pixel. Rebuilding a bounding box inside the
  // sampling loop is what took an early version of this render from seconds to
  // minutes.
  const prepared = shapeList.map(prepare)
  const toneRgb = prepared.map((p) => hexToRgb(faces[p.tone]))

  // Device-space bounding box per shape, so most pixels skip supersampling.
  const boxes = prepared.map((p) => ({
    left: p.box[0] * unit + originX - 1,
    top: p.box[1] * unit + originY - 1,
    right: p.box[2] * unit + originX + 1,
    bottom: p.box[3] * unit + originY + 1,
  }))

  const base = background ? hexToRgb(background) : null
  const rgba = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let coverage = 0

      for (let i = 0; i < prepared.length; i++) {
        const box = boxes[i]
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
          continue
        }

        const p = prepared[i]
        let hits = 0
        for (let sy = 0; sy < AA; sy++) {
          const uy = toUnitY(y + (sy + 0.5) / AA)
          for (let sx = 0; sx < AA; sx++) {
            const ux = toUnitX(x + (sx + 0.5) / AA)
            if (p.covers(ux, uy)) hits++
          }
        }
        if (hits === 0) continue

        const cov = hits / (AA * AA)
        const [cr, cg, cb] = toneRgb[i]
        r += cr * cov
        g += cg * cov
        b += cb * cov
        coverage += cov
      }

      if (coverage > 0) {
        r /= coverage
        g /= coverage
        b /= coverage
      }
      let alpha = Math.min(1, coverage)

      if (base) {
        r = r * alpha + base[0] * (1 - alpha)
        g = g * alpha + base[1] * (1 - alpha)
        b = b * alpha + base[2] * (1 - alpha)
        alpha = 1
      }

      const o = (y * size + x) * 4
      rgba[o] = Math.round(r)
      rgba[o + 1] = Math.round(g)
      rgba[o + 2] = Math.round(b)
      rgba[o + 3] = Math.round(alpha * 255)
    }
  }

  return encodePng(rgba, size, size)
}

// --- PNG encoding ------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** 8-bit RGBA PNG, one filter-0 scanline per row. */
function encodePng(rgba, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// --- outputs -----------------------------------------------------------------

const written = []

function write(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, contents)
  written.push(path.relative(ROOT, file))
}

const MARK = { faces: LIGHT_FACES, shapeList: MARK_SHAPES }
const MARK_DARK = { ...MARK, faces: DARK_FACES }
const COMPACT = { faces: LIGHT_FACES, shapeList: COMPACT_SHAPES }

function main() {
  // 1. Canonical SVG sources.
  write(path.join(BRAND_DIR, 'game-engine-mark.svg'), markSvg(MARK))
  write(
    path.join(BRAND_DIR, 'game-engine-mark-dark.svg'),
    markSvg({
      ...MARK_DARK,
      note: '  Lighter face tones, for any dark surface where the #065f46 lower-right face\n  loses contrast.',
    }),
  )
  write(
    path.join(BRAND_DIR, 'game-engine-mark-compact.svg'),
    markSvg({
      ...COMPACT,
      note: '  Two-face reduction for sizes where the four tones muddy and the internal\n  seams stop resolving: favicons, and anything below roughly 24 px.',
    }),
  )
  write(path.join(BRAND_DIR, 'game-engine-social-card.svg'), socialCardSvg())

  // 2. A 512 px PNG of the mark. npm does not resolve relative paths and the org
  //    landing site reads this file over raw.githubusercontent.com, so this is
  //    the one raster every external consumer sees. Transparent, so it sits
  //    correctly on GitHub's light and dark themes.
  write(
    path.join(BRAND_DIR, 'game-engine-mark.png'),
    renderMark({ ...MARK, size: 512, scale: 0.9 }),
  )

  // 3. Expo app assets, written to both example apps so the 2D and the 3D demo
  //    cannot drift apart.
  //
  //    Scales are per slot: the store icon fills its tile, the adaptive
  //    foreground has to stay inside Android's 66% safe circle, and the splash
  //    mark is small because `splash.resizeMode: contain` scales this 1024
  //    square to the screen width.
  //
  //    Only `icon.png` is composited onto a background, because iOS rejects an
  //    app icon with an alpha channel. It takes the lighter tones, since its
  //    canvas is dark. The other three stay transparent and take the standard
  //    tones, which is what lets one raster serve `example` on a white splash
  //    and `example-3d` on a #111111 one without a per-app palette.
  const appAssets = {
    'icon.png': renderMark({
      ...MARK_DARK,
      size: 1024,
      scale: 0.66,
      background: CANVAS_DARK,
    }),
    'adaptive-icon.png': renderMark({ ...MARK, size: 1024, scale: 0.45 }),
    'splash-icon.png': renderMark({ ...MARK, size: 1024, scale: 0.34 }),
    'favicon.png': renderMark({ ...COMPACT, size: 64, scale: 0.94 }),
  }

  for (const dir of EXAMPLE_ASSET_DIRS) {
    for (const [file, contents] of Object.entries(appAssets)) {
      write(path.join(dir, file), contents)
    }
  }

  console.log(`Wrote ${written.length} brand assets:`)
  for (const file of written) console.log(`  ${file}`)
}

main()
