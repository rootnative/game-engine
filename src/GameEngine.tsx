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
import {
  GestureDetector,
  useLongPressGesture,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
  type LongPressGestureConfig,
  type PanGestureConfig,
  type TapGestureConfig,
} from 'react-native-gesture-handler';
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

  const panConfig = useMemo<PanGestureConfig>(
    () => ({
      onBegin: (e) => {
        'worklet';
        scheduleOnRN(pushTouch, { id: 0, type: 'start', x: e.x, y: e.y, t: Date.now() });
      },
      onUpdate: (e) => {
        'worklet';
        scheduleOnRN(pushTouch, {
          id: 0,
          type: 'move',
          x: e.x,
          y: e.y,
          dx: e.changeX,
          dy: e.changeY,
          t: Date.now(),
        });
      },
      onDeactivate: (e) => {
        'worklet';
        scheduleOnRN(pushTouch, { id: 0, type: 'end', x: e.x, y: e.y, t: Date.now() });
      },
    }),
    [pushTouch],
  );

  const tapConfig = useMemo<TapGestureConfig>(
    () => ({
      onDeactivate: (e) => {
        'worklet';
        if (e.canceled) return;
        scheduleOnRN(pushTouch, { id: 0, type: 'tap', x: e.x, y: e.y, t: Date.now() });
      },
    }),
    [pushTouch],
  );

  const longPressConfig = useMemo<LongPressGestureConfig>(
    () => ({
      onDeactivate: (e) => {
        'worklet';
        if (e.canceled) return;
        scheduleOnRN(pushTouch, { id: 0, type: 'long-press', x: e.x, y: e.y, t: Date.now() });
      },
    }),
    [pushTouch],
  );

  const pan = usePanGesture(panConfig);
  const tap = useTapGesture(tapConfig);
  const longPress = useLongPressGesture(longPressConfig);
  const gesture = useSimultaneousGestures(pan, tap, longPress);

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
