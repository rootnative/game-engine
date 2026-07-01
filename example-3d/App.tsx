import { GameEngine } from '@onlynative/game-engine';
import { ThreeRenderer, useGltf } from '@onlynative/game-engine/renderers/three';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { loadScene } from './src/scene';

// Khronos's tiny "Box" sample. ~3 KB binary glTF, no external resources —
// safest possible smoke test for the glb pipeline.
const BOX_GLB =
  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Box/glTF-Binary/Box.glb';

function GameView() {
  const gltf = useGltf(BOX_GLB);
  const scene = useMemo(() => loadScene(gltf), [gltf]);
  const renderer = (
    <ThreeRenderer
      world={scene.world}
      transform={scene.transform}
      mesh={scene.mesh}
      meshes={scene.meshes}
      camera={scene.camera}
      ambientLight={scene.ambientLight}
      directionalLight={scene.directionalLight}
      clearColor={0x111111}
    />
  );
  return <GameEngine world={scene.world} systems={scene.systems} renderer={renderer} />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.root}>
        <Suspense fallback={null}>
          <GameView />
        </Suspense>
      </View>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
