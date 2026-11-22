import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { AppBackground } from '../ui';
import { colors } from '../../lib/theme';
import { introLogoSize } from '../../lib/responsive';
import AnimatedLogo, { EASE_OUT, Wordmark } from './AnimatedLogo';
import { finishIntro, hasIntroPlayed, INTRO_FADE_MS, INTRO_HOLD_MS, markIntroStarted } from './intro';

// Short brand moment shown once each time the app opens. Tap anywhere to skip.
export default function BrandIntro() {
  const reduce = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [visible, setVisible] = useState(() => !hasIntroPlayed());
  const fade = useSharedValue(1);
  const closing = useRef(false);
  const size = introLogoSize(width, height);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    finishIntro(); // Home starts revealing as the intro begins to fade
    fade.value = withTiming(0, { duration: INTRO_FADE_MS, easing: Easing.out(Easing.cubic) });
    setTimeout(() => setVisible(false), INTRO_FADE_MS + 30);
  };

  useEffect(() => {
    if (!visible) {
      finishIntro();
      return;
    }
    markIntroStarted();
    const t = setTimeout(close, reduce ? 900 : INTRO_HOLD_MS);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  if (!visible) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }, fadeStyle]}>
      <AppBackground />
      <Pressable style={s.center} onPress={close} accessibilityRole="button" accessibilityLabel="Arrive Notify. Tap to skip the intro">
        <AnimatedLogo size={size} />
        <View style={{ height: size * 0.5 }} />
        <Wordmark fontSize={Math.round(size * 0.25)} delay={650} />
        <Animated.View entering={reduce ? undefined : FadeInDown.delay(1150).duration(700).easing(EASE_OUT)}>
          <Text style={[s.tag, { fontSize: Math.max(15, Math.round(size * 0.115)) }]}>
            Don’t text. <Text style={{ color: colors.accent }}>Just arrive.</Text>
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tag: { color: colors.mute, fontWeight: '700', marginTop: 12, textAlign: 'center' },
});
