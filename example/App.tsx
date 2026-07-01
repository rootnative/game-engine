import { Suspense, use, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { GameEngine } from '@rootnative/game-engine';
import { SkiaRenderer, type SkiaAtlas } from '@rootnative/game-engine/renderers/skia';

import { HUD } from './src/HUD';
import { loadLevel } from './src/game';
import { gameStore } from './src/game/store';

export default function App() {
  const [levelKey, setLevelKey] = useState(0);
  const [, startTransition] = useTransition();

  const onRestart = useCallback(() => {
    startTransition(() => setLevelKey((k) => k + 1));
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <Suspense fallback={<Loading />}>
            <GameRoot levelKey={levelKey} onRestart={onRestart} />
          </Suspense>
          <StatusBar style="auto" />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function GameRoot({ levelKey, onRestart }: { levelKey: number; onRestart: () => void }) {
  const levelPromise = useMemo(() => loadLevel({ onRestart }), [levelKey, onRestart]);
  const level = use(levelPromise);

  const atlases = useSharedValue<ReadonlyArray<SkiaAtlas>>(level.atlases);
  useEffect(() => {
    atlases.value = level.atlases;
  }, [atlases, level]);

  useEffect(() => {
    gameStore.reset();
  }, [level]);

  return (
    <GameEngine
      world={level.world}
      systems={level.systems}
      renderer={
        <SkiaRenderer
          world={level.world}
          position={level.Position}
          sprite={level.Sprite}
          atlases={atlases}
        />
      }
    >
      <HUD />
    </GameEngine>
  );
}

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#1f2937" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, backgroundColor: '#fafafa' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
