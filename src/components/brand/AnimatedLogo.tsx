import { memo, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay,
  withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { GradientView } from '../ui';
import { colors } from '../../lib/theme';
import type { ReactNode } from 'react';

// Smooth "expo-out" curve: quick start, long soft landing. Used for every entrance.
export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const SOFT = Easing.inOut(Easing.sin);

// soft bell-shaped highlight: 11 thin strips fade in and out, so the glint has no hard edges
const SHEEN_PROFILE = Array.from({ length: 11 }, (_, i) => Number((0.36 * Math.exp(-((i - 5) ** 2) / 8)).toFixed(3)));

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

// ───────────────────────── The Arrive Notify mark: blue tile with a location pin ─────────────────────────
function Pin({ s }: { s: number }) {
  const head = s * 0.74;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: head, height: head, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: -s * 0.05,
          borderTopLeftRadius: head / 2, borderTopRightRadius: head / 2, borderBottomRightRadius: head / 2, borderBottomLeftRadius: 0,
          transform: [{ rotate: '-45deg' }],
          shadowColor: '#0B1F6B', shadowOpacity: 0.35, shadowRadius: s * 0.08, shadowOffset: { width: 0, height: s * 0.05 },
        }}
      >
        <View style={{ width: head * 0.4, height: head * 0.4, borderRadius: head * 0.2, backgroundColor: '#3E6BF0' }} />
      </View>
    </View>
  );
}

type Props = {
  size?: number; // tile size in px (layout size). Glow and orbit extend beyond it without moving other content.
  intro?: boolean; // play the entrance
  delay?: number; // ms before the entrance starts
  idle?: boolean; // keep floating, glowing and shining
  active?: boolean; // pass false while the screen is hidden to pause the loops
  orbit?: boolean; // orbit ring (default: on for sizes of 72 and up)
};

function AnimatedLogoBase({ size = 96, intro = true, delay = 0, idle = true, active = true, orbit }: Props) {
  const reduce = useReducedMotion();
  const appActive = useAppActive();
  const showOrbit = orbit ?? size >= 72;
  const bands = Math.round(Math.min(48, Math.max(6, size / 4))); // enough steps that the gradient looks smooth

  const start = intro && !reduce ? 0 : 1;
  const enter = useSharedValue(start); // 0 to 1: overall entrance
  const pop = useSharedValue(start); // spring for the tile scale (overshoots a little)
  const burst = useSharedValue(0); // one-time light burst behind the tile
  const float = useSharedValue(0);
  const tilt = useSharedValue(0);
  const spin = useSharedValue(0);
  const pulse = useSharedValue(0);
  const sheen = useSharedValue(0);

  // entrance, once
  useEffect(() => {
    if (!intro || reduce) return;
    enter.value = withDelay(delay, withTiming(1, { duration: 1100, easing: EASE_OUT }));
    pop.value = withDelay(delay, withSpring(1, { damping: 13, stiffness: 130, mass: 0.9 }));
    burst.value = withDelay(delay + 80, withSequence(withTiming(1, { duration: 520, easing: EASE_OUT }), withTiming(0, { duration: 1100, easing: SOFT })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // idle loops: float, 3D tilt, orbit spin, glow pulse and a periodic chrome sheen. Paused when hidden or in the background.
  useEffect(() => {
    const all = [float, tilt, spin, pulse, sheen];
    if (!idle || !active || !appActive || reduce) {
      all.forEach(cancelAnimation);
      return;
    }
    const wait = intro ? delay + 700 : 0;
    float.value = withDelay(wait, withRepeat(withTiming(1, { duration: 3200, easing: SOFT }), -1, true));
    tilt.value = withDelay(wait, withRepeat(withSequence(withTiming(1, { duration: 4600, easing: SOFT }), withTiming(-1, { duration: 4600, easing: SOFT })), -1, true));
    spin.value = withRepeat(withTiming(360, { duration: 18000, easing: Easing.linear }), -1, false);
    pulse.value = withDelay(wait, withRepeat(withTiming(1, { duration: 2600, easing: SOFT }), -1, true));
    sheen.value = withDelay(wait + 600, withRepeat(withSequence(withDelay(2800, withTiming(1, { duration: 1250, easing: Easing.inOut(Easing.cubic) })), withTiming(0, { duration: 0 })), -1, false));
    return () => all.forEach(cancelAnimation);
  }, [idle, active, appActive, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const tileStyle = useAnimatedStyle(() => {
    const e = enter.value;
    return {
      opacity: Math.min(1, e * 4),
      transform: [
        { perspective: 700 },
        { translateY: (1 - e) * size * 0.14 + (float.value - 0.5) * size * 0.07 * e },
        { rotateX: `${tilt.value * 5 * e}deg` },
        { rotateY: `${tilt.value * -7 * e}deg` },
        { rotateZ: `${(1 - e) * -18}deg` },
        { scale: interpolate(pop.value, [0, 1], [0.55, 1]) },
      ],
    };
  });

  const glowStyle = useAnimatedStyle(() => ({
    opacity: enter.value * (0.65 + pulse.value * 0.35),
    transform: [{ scale: 0.85 + enter.value * 0.15 + pulse.value * 0.07 + burst.value * 0.24 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(enter.value, [0.15, 0.8], [0, 1], 'clamp'),
    transform: [
      { perspective: 800 },
      { rotateX: '70deg' },
      { rotateZ: `${spin.value}deg` },
      { scale: interpolate(enter.value, [0.15, 1], [0.6, 1], 'clamp') },
    ],
  }));

  const groundStyle = useAnimatedStyle(() => ({
    opacity: enter.value * (0.55 - (float.value - 0.5) * 0.35),
    transform: [{ scaleX: 1 - (float.value - 0.5) * 0.14 }],
  }));

  const sheenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(sheen.value, [0, 1], [-size * 0.95, size * 1.15]) }, { rotate: '22deg' }],
  }));

  const r = size * 0.28;
  const ring = size * 1.62;
  // many faint rings blend into one soft light (no blur needed); fewer on small logos
  const rings: { k: number; a: number }[] =
    size >= 72
      ? Array.from({ length: 10 }, (_, i) => ({ k: 2.15 - i * 0.105, a: 0.03 }))
      : Array.from({ length: 4 }, (_, i) => ({ k: 1.75 - i * 0.16, a: 0.06 }));

  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel="Arrive Notify logo">
      {/* soft light behind the tile */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glowStyle]}>
        {rings.map(({ k, a }) => (
          <View
            key={k}
            style={{
              position: 'absolute', width: size * k, height: size * k, borderRadius: size * k, left: (size - size * k) / 2, top: (size - size * k) / 2,
              backgroundColor: `rgba(71,120,255,${a})`,
            }}
          />
        ))}
      </Animated.View>

      {/* tilted orbit with a travelling light */}
      {showOrbit && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', width: ring, height: ring, left: (size - ring) / 2, top: (size - ring) / 2, borderRadius: ring / 2, borderWidth: Math.max(1, size * 0.011), borderColor: 'rgba(99,165,255,0.5)' },
            ringStyle,
          ]}
        >
          <View style={{ position: 'absolute', top: -size * 0.04, left: ring / 2 - size * 0.04, width: size * 0.08, height: size * 0.08, borderRadius: size * 0.04, backgroundColor: '#B7D4FF', shadowColor: colors.accent, shadowOpacity: 1, shadowRadius: size * 0.08, shadowOffset: { width: 0, height: 0 } }} />
          <View style={{ position: 'absolute', bottom: -size * 0.025, left: ring / 2 - size * 0.025, width: size * 0.05, height: size * 0.05, borderRadius: size * 0.025, backgroundColor: 'rgba(183,212,255,0.65)' }} />
        </Animated.View>
      )}

      {/* light cast below the tile: moves opposite to the float for depth */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, groundStyle]}>
        <View style={{ position: 'absolute', width: size * 0.96, height: size * 0.15, left: size * 0.02, top: size * 1.05, borderRadius: size, backgroundColor: 'rgba(71,120,255,0.10)' }} />
        <View style={{ position: 'absolute', width: size * 0.62, height: size * 0.08, left: size * 0.19, top: size * 1.085, borderRadius: size, backgroundColor: 'rgba(99,165,255,0.2)' }} />
      </Animated.View>

      {/* the logo tile */}
      <Animated.View style={[{ width: size, height: size, borderRadius: r, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, tileStyle]}>
        <TileFill size={size} bands={bands} />
        <View style={{ position: 'absolute', width: size * 1.2, height: size * 0.9, left: -size * 0.1, top: -size * 0.56, borderRadius: size * 0.6, backgroundColor: 'rgba(255,255,255,0.16)' }} />
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Pin s={size * 0.62} />
        </View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -size * 0.35, left: 0, width: size * 0.62, height: size * 1.7, flexDirection: 'row' }, sheenStyle]}>
          {SHEEN_PROFILE.map((a, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: `rgba(255,255,255,${a})` }} />
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function TileFill({ size, bands }: { size: number; bands: number }) {
  // brand blue, lighter at the top like light falling on glass
  return <GradientView from="#7FB0FF" to="#3558D6" style={StyleSheet.absoluteFill} bands={bands} />;
}

export const AnimatedLogo = memo(AnimatedLogoBase);
export default AnimatedLogo;

// ───────────────────────── Wordmark: letters rise in one after another ─────────────────────────
export function Wordmark({ fontSize = 18, delay = 0, stagger = 30 }: { fontSize?: number; delay?: number; stagger?: number }) {
  const reduce = useReducedMotion();
  const letters = 'Arrive Notify'.split('');
  return (
    <View style={{ flexDirection: 'row' }} accessible accessibilityRole="header" accessibilityLabel="Arrive Notify">
      {letters.map((ch, i) => (
        <Animated.Text
          key={i}
          importantForAccessibility="no"
          entering={reduce ? undefined : FadeInDown.delay(delay + i * stagger).duration(560).easing(EASE_OUT)}
          style={{ color: i >= 7 ? colors.accent : colors.ink, fontSize, fontWeight: '800', letterSpacing: -fontSize * 0.02 }}
        >
          {ch === ' ' ? '\u00A0' : ch}
        </Animated.Text>
      ))}
    </View>
  );
}

// ───────────────────────── Reveal: staggered fade-and-rise for page sections ─────────────────────────
export function Reveal({ index = 0, delay = 0, when = true, children, style }: { index?: number; delay?: number; when?: boolean; children: ReactNode; style?: ViewStyle }) {
  const reduce = useReducedMotion();
  if (!when) return null; // not shown until the intro lets go of the screen
  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.delay(delay + index * 70).duration(560).easing(EASE_OUT)} style={style}>
      {children}
    </Animated.View>
  );
}
