import {
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { createLoop, type Loop } from './core/loop';
import type { System, TouchEvent, World } from './core/types';

export interface GameEngineProps {
  readonly world: World | Promise<World>;
  readonly systems: ReadonlyArray<System> | Promise<ReadonlyArray<System>>;
  readonly renderer: ReactNode;
  readonly running?: boolean;
  readonly hz?: number;
  readonly children?: ReactNode;
}

function isThenable<T>(v: unknown): v is PromiseLike<T> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'then' in v &&
    typeof (v as { then: unknown }).then === 'function'
  );
}

const EngineContext = createContext<Loop | null>(null);

export function useEngine(): Loop {
  const loop = useContext(EngineContext);
  if (!loop) {
    throw new Error('useEngine must be called inside <GameEngine>');
  }
  return loop;
}

export function GameEngine({
  world,
  systems,
  renderer,
  running = true,
  hz = 60,
  children,
}: GameEngineProps) {
  const resolvedWorld = isThenable<World>(world) ? use(world) : world;
  const resolvedSystems = isThenable<ReadonlyArray<System>>(systems) ? use(systems) : systems;

  const loop = useMemo(
    () => createLoop(resolvedWorld, resolvedSystems, { hz }),
    [hz],
  );

  useEffect(() => {
    loop.swap(resolvedWorld, resolvedSystems);
  }, [loop, resolvedWorld, resolvedSystems]);

  useEffect(() => {
    if (running) loop.start();
    return () => loop.stop();
  }, [loop, running]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    loop.setScreen(width, height);
  };

  const pushTouch = useCallback(
    (e: TouchEvent) => {
      loop.pushTouch(e);
    },
    [loop],
  );

  const prevTx = useSharedValue(0);
  const prevTy = useSharedValue(0);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onBegin((e) => {
        'worklet';
        prevTx.value = 0;
        prevTy.value = 0;
        scheduleOnRN(pushTouch, { id: 0, type: 'start', x: e.x, y: e.y, t: Date.now() });
      })
      .onUpdate((e) => {
        'worklet';
        const dx = e.translationX - prevTx.value;
        const dy = e.translationY - prevTy.value;
        prevTx.value = e.translationX;
        prevTy.value = e.translationY;
        scheduleOnRN(pushTouch, { id: 0, type: 'move', x: e.x, y: e.y, dx, dy, t: Date.now() });
      })
      .onEnd((e) => {
        'worklet';
        scheduleOnRN(pushTouch, { id: 0, type: 'end', x: e.x, y: e.y, t: Date.now() });
      });

    const tap = Gesture.Tap().onEnd((e, success) => {
      'worklet';
      if (!success) return;
      scheduleOnRN(pushTouch, { id: 0, type: 'tap', x: e.x, y: e.y, t: Date.now() });
    });

    const longPress = Gesture.LongPress().onEnd((e, success) => {
      'worklet';
      if (!success) return;
      scheduleOnRN(pushTouch, { id: 0, type: 'long-press', x: e.x, y: e.y, t: Date.now() });
    });

    return Gesture.Simultaneous(pan, tap, longPress);
  }, [pushTouch, prevTx, prevTy]);

  return (
    <EngineContext.Provider value={loop}>
      <GestureDetector gesture={gesture}>
        <View style={styles.root} onLayout={onLayout} collapsable={false}>
          {renderer}
          {children}
        </View>
      </GestureDetector>
    </EngineContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
