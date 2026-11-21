import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSharedValue } from 'react-native-reanimated'
import { BoxGeometry, MeshNormalMaterial } from 'three'
import {
  GameEngine,
  addComponent,
  createEntity,
  createPhysics,
  createWorld,
  defineComponent,
  type System,
} from '@rootnative/game-engine'
import {
  SkiaRenderer,
  loadSkiaAtlas,
  type SkiaAtlas,
} from '@rootnative/game-engine/renderers/skia'
import {
  ThreeRenderer,
  type MeshDef,
} from '@rootnative/game-engine/renderers/three'

// An app that installs the packed tarball from npm's point of view. CI type
// checks it and bundles it for iOS and Android. It never runs.

const world2d = createWorld({ capacity: 64 })
const Position = defineComponent(world2d, { x: 'f32', y: 'f32' })
const Velocity = defineComponent(world2d, { x: 'f32', y: 'f32' })
const Sprite = defineComponent(world2d, {
  atlas: 'u32',
  frame: 'u16',
  tint: 'u32',
})

const physics = createPhysics({
  world: world2d,
  position: Position,
  velocity: Velocity,
  gravity: { x: 0, y: 600 },
})

const ball = createEntity(world2d)
addComponent(world2d, ball, Sprite, { atlas: 0, frame: 0, tint: 0xffffffff })
physics.attach(ball, {
  type: 'dynamic',
  position: { x: 100, y: 50 },
  shape: { kind: 'circle', radius: 8 },
})

const systems2d: ReadonlyArray<System> = [physics.step]

const world3d = createWorld({ capacity: 8 })
const Transform = defineComponent(world3d, {
  x: 'f32',
  y: 'f32',
  z: 'f32',
  rx: 'f32',
  ry: 'f32',
  rz: 'f32',
  sx: 'f32',
  sy: 'f32',
  sz: 'f32',
})
const Mesh = defineComponent(world3d, { mesh: 'u32' })

const cube = createEntity(world3d)
addComponent(world3d, cube, Transform, { sx: 1, sy: 1, sz: 1 })
addComponent(world3d, cube, Mesh, { mesh: 0 })

const spin: System = (_world, ctx) => {
  Transform.data.ry[cube] += ctx.time.delta
}
const systems3d: ReadonlyArray<System> = [spin]

function Game2D() {
  const atlases = useSharedValue<ReadonlyArray<SkiaAtlas>>([])
  useEffect(() => {
    loadSkiaAtlas('https://example.com/ball.png').then((atlas) => {
      atlases.value = [atlas]
    })
  }, [atlases])

  return (
    <GameEngine
      world={world2d}
      systems={systems2d}
      renderer={
        <SkiaRenderer
          world={world2d}
          position={Position}
          sprite={Sprite}
          atlases={atlases}
        />
      }
    />
  )
}

function Game3D() {
  const meshes = useMemo<ReadonlyArray<MeshDef>>(
    () => [
      {
        geometry: new BoxGeometry(1, 1, 1),
        material: new MeshNormalMaterial(),
      },
    ],
    [],
  )

  return (
    <GameEngine
      world={world3d}
      systems={systems3d}
      renderer={
        <ThreeRenderer
          world={world3d}
          transform={Transform}
          mesh={Mesh}
          meshes={meshes}
        />
      }
    />
  )
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.root}>
        <Game2D />
      </View>
      <View style={styles.root}>
        <Game3D />
      </View>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
