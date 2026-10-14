import { StyleSheet, Text, View } from 'react-native';

import { useGameState } from './game/store';

export function HUD() {
  const state = useGameState();
  return (
    <View pointerEvents="none" style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.text}>Score {state.score}</Text>
        <Text style={styles.text}>Lives {state.lives}</Text>
      </View>
      {state.status !== 'playing' ? (
        <View style={styles.banner}>
          <Text style={styles.title}>{titleFor(state.status)}</Text>
          <Text style={styles.subtitle}>Tap to {state.status === 'ready' ? 'start' : 'play again'}</Text>
        </View>
      ) : null}
    </View>
  );
}

function titleFor(status: 'ready' | 'won' | 'lost'): string {
  if (status === 'ready') return 'Breakout';
  if (status === 'won') return 'You win!';
  return 'Game over';
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-start',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  text: {
    color: '#1f2937',
    fontSize: 16,
    fontWeight: '600',
  },
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '38%',
    alignItems: 'center',
  },
  title: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    marginTop: 8,
    color: '#4b5563',
    fontSize: 16,
  },
});
