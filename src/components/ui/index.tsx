import { ReactElement, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Image, Modal, Pressable, RefreshControlProps, ScrollView, StyleProp,
  StyleSheet, Switch, Text, TextInput, TextInputProps, TextStyle, useWindowDimensions, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon, { IconName } from './Icon';
import { colors, glow, mono, radius, size, type } from '../../lib/theme';
import { CONTENT_MAX } from '../../lib/responsive';

export { Icon };
export type { IconName };

// ───────────────────────── Background (ambient blue light, no extra libraries) ─────────────────────────
type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function ramp(stops: [number, string][], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const a = hex(c0), b = hex(c1);
    out.push(`rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(',')})`);
  }
  return out;
}
const BG_BANDS = ramp([[0, '#16276F'], [0.3, '#0C1538'], [0.62, '#070C1F'], [1, '#050816']], 72);

export function AppBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {BG_BANDS.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
    </View>
  );
}

// Soft vertical gradient used inside hero cards
export function GradientView({ from, to, style, children, bands: count = 14 }: { from: string; to: string; style?: StyleProp<ViewStyle>; children?: ReactNode; bands?: number }) {
  const bands = useMemo(() => ramp([[0, from], [1, to]], count), [from, to, count]);
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {bands.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
      </View>
      {children}
    </View>
  );
}

// ───────────────────────── Screen + header ─────────────────────────
export function Screen({
  children, scroll, tab, refreshControl, footer, contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  tab?: boolean; // screen lives above the bottom tab bar
  refreshControl?: ReactElement<RefreshControlProps>;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // on wide screens (tablet, desktop) the content stays a centred column instead of stretching edge to edge
  const column: ViewStyle | null = width > CONTENT_MAX + 40 ? { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' } : null;
  const pad: ViewStyle = {
    paddingTop: insets.top + 14,
    paddingHorizontal: 20,
    paddingBottom: tab || footer ? 20 : insets.bottom + 24,
    ...column,
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBackground />
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[pad, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[st.footer, { paddingBottom: tab ? 14 : insets.bottom + 14 }]}>
          <View style={[{ width: '100%' }, column ? { maxWidth: CONTENT_MAX, alignSelf: 'center' } : null]}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

export function IconButton({ icon, onPress, tone = 'default', label }: { icon: IconName; onPress: () => void; tone?: 'default' | 'emergency'; label?: string }) {
  const emergency = tone === 'emergency';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? icon}
      hitSlop={6}
      style={({ pressed }) => [st.iconBtn, emergency && { backgroundColor: colors.emergency, borderColor: colors.emergency }, pressed && { opacity: 0.8 }]}
    >
      <Icon name={icon} size={size.icon} color={colors.ink} />
    </Pressable>
  );
}

export function ScreenHeader({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={st.header}>
      {onBack ? <IconButton icon="back" onPress={onBack} label="Go back" /> : null}
      <View style={{ flex: 1 }}>
        <Text style={type.h1 as TextStyle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[st.mute, { marginTop: 2 }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={st.section}>
      <Text style={type.h3 as TextStyle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={st.link}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Small tracked label, used the way the deck uses them (receipts, target zone, step names)
export function Overline({ children, color = colors.dim }: { children: ReactNode; color?: string }) {
  return <Text style={[type.tag as TextStyle, { color, fontFamily: mono, textTransform: 'uppercase' }]}>{children}</Text>;
}

// ───────────────────────── Cards ─────────────────────────
type CardTone = 'default' | 'selected' | 'emergency' | 'success' | 'flat';
const CARD_TONES: Record<CardTone, ViewStyle> = {
  default: { backgroundColor: colors.card, borderColor: colors.line },
  selected: { backgroundColor: colors.routeSoft, borderColor: colors.route },
  emergency: { backgroundColor: colors.emergencySoft, borderColor: colors.emergencyLine },
  success: { backgroundColor: colors.successSoft, borderColor: '#1E6F5E' },
  flat: { backgroundColor: colors.surface, borderColor: colors.lineSoft },
};

export function Card({ children, style, onPress, tone = 'default' }: { children?: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: CardTone }) {
  const base = [st.card, CARD_TONES[tone], style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && { opacity: 0.88 }]}>
      {children}
    </Pressable>
  );
}

// ───────────────────────── Buttons ─────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
export function Button({
  title, onPress, variant = 'primary', icon, loading, disabled, small, full = true, style,
}: {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = BTN[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        st.btn,
        { height: small ? size.buttonSm : size.button, backgroundColor: v.bg, borderColor: v.border },
        variant === 'primary' && !off && glow(colors.route),
        !full && { alignSelf: 'flex-start', paddingHorizontal: small ? 16 : 22 },
        off && { opacity: 0.55 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={small ? size.iconSm : size.icon} color={v.fg} /> : null}
          <Text style={[st.btnText, { color: v.fg, fontSize: small ? 13 : 16 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}
const BTN: Record<BtnVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.route, fg: colors.onPrimary, border: colors.route },
  secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
  danger: { bg: colors.emergency, fg: '#1A0A06', border: colors.emergency },
  success: { bg: colors.success, fg: '#04231B', border: colors.success },
  ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
};

// ───────────────────────── Badges, chips, progress ─────────────────────────
type Tone = 'blue' | 'green' | 'orange' | 'amber' | 'neutral';
const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  blue: { bg: colors.routeSoft, fg: colors.accent, border: '#2A4590' },
  green: { bg: colors.successSoft, fg: colors.success, border: '#1E6F5E' },
  orange: { bg: colors.emergencySoft, fg: colors.emergency, border: colors.emergencyLine },
  amber: { bg: colors.warningSoft, fg: colors.warning, border: '#6B531F' },
  neutral: { bg: colors.surface, fg: colors.mute, border: colors.lineSoft },
};
export const toneColor = (t: Tone) => TONES[t].fg;

export function Badge({ label, tone = 'blue', icon, dot, caps = true }: { label: string; tone?: Tone; icon?: IconName; dot?: boolean; caps?: boolean }) {
  const t = TONES[tone];
  return (
    <View style={[st.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      {dot ? <View style={[st.dot, { backgroundColor: t.fg }]} /> : null}
      {icon ? <Icon name={icon} size={12} color={t.fg} /> : null}
      <Text style={[type.tag as TextStyle, { color: t.fg, textTransform: caps ? 'uppercase' : 'none', fontFamily: caps ? mono : undefined }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.chip, selected && { backgroundColor: colors.route, borderColor: colors.route }, pressed && { opacity: 0.85 }]}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? colors.onPrimary : colors.mute} /> : null}
      <Text style={[st.chipText, selected && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'green' | 'light' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill = tone === 'green' ? colors.success : tone === 'light' ? '#FFFFFF' : colors.route;
  const track = tone === 'light' ? 'rgba(255,255,255,0.28)' : colors.surface;
  return (
    <View style={[st.track, { backgroundColor: track }]}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: radius.pill, backgroundColor: fill }} />
    </View>
  );
}

// Pulsing dot for "live" indicators (single gentle animation)
export function PulseDot({ color = colors.success, active = true }: { color?: string; active?: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [a, active]);
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      {active ? (
        <Animated.View
          style={{
            position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: color,
            opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] }) }],
          }}
        />
      ) : null}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

// ───────────────────────── People / icons ─────────────────────────
export function Avatar({ name, px = 44, tone = 'blue' }: { name?: string | null; px?: number; tone?: 'blue' | 'green' | 'orange' }) {
  const initials = (name ?? '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  const bg = tone === 'green' ? colors.success : tone === 'orange' ? colors.emergency : colors.route;
  return (
    <View style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: tone === 'green' ? '#04231B' : '#FFFFFF', fontWeight: '800', fontSize: px * 0.36 }}>{initials}</Text>
    </View>
  );
}

// Shows the person's picture when they have one, otherwise their initials
export function PersonAvatar({ name, url, px = 44 }: { name?: string | null; url?: string | null; px?: number }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <Image source={{ uri: url }} onError={() => setFailed(true)} style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: colors.surface }} />;
  }
  return <Avatar name={name} px={px} />;
}

export function IconTile({ icon, tone = 'blue', px = size.tile, children }: { icon?: IconName; tone?: Tone; px?: number; children?: ReactNode }) {
  const t = TONES[tone];
  return (
    <View style={{ width: px, height: px, borderRadius: radius.md, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
      {children ?? (icon ? <Icon name={icon} size={px * 0.5} color={t.fg} /> : null)}
    </View>
  );
}

// ───────────────────────── Rows ─────────────────────────
export function ListRow({
  icon, title, subtitle, right, onPress, tone = 'blue', last,
}: { icon?: IconName; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; tone?: Tone; last?: boolean }) {
  const body = (
    <View style={[st.row, !last && st.rowDivider]}>
      {icon ? <IconTile icon={icon} tone={tone} px={38} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle}>{title}</Text>
        {subtitle ? <Text style={st.mute}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={size.iconSm} color={colors.dim} /> : null)}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.8 }}>{body}</Pressable> : body;
}

export function ToggleRow({
  icon, tone, title, subtitle, value, onValueChange, disabled, last,
}: { icon?: IconName; tone?: Tone; title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; last?: boolean }) {
  return (
    <ListRow
      icon={icon}
      tone={tone}
      title={title}
      subtitle={subtitle}
      last={last}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.lineSoft, true: colors.route }}
          thumbColor="#FFFFFF"
        />
      }
    />
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: 12 }} />;
}

// ───────────────────────── Inputs ─────────────────────────
export function Input({ icon, label, right, style, ...props }: TextInputProps & { icon?: IconName; label?: string; right?: ReactNode }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={st.label}>{label}</Text> : null}
      <View style={[st.input, props.multiline && { height: undefined, minHeight: 92, alignItems: 'flex-start', paddingVertical: 14 }, focus && { borderColor: colors.accent }]}>
        {icon ? <Icon name={icon} size={size.icon} color={focus ? colors.accent : colors.dim} /> : null}
        <TextInput
          placeholderTextColor={colors.dim}
          selectionColor={colors.accent}
          {...props}
          onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
          style={[st.inputText, props.multiline && { textAlignVertical: 'top', alignSelf: 'stretch' }, style]}
        />
        {right}
      </View>
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }: { value: string; onChangeText: (t: string) => void; placeholder?: string }) {
  return (
    <View style={st.input}>
      <Icon name="search" size={size.icon} color={colors.dim} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        style={st.inputText}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10}>
          <Icon name="cancel" size={size.icon} color={colors.dim} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ───────────────────────── Dialogs & empty states ─────────────────────────
export function ConfirmModal({
  visible, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', busy, confirmDisabled, children, onConfirm, onCancel,
}: {
  visible: boolean; title: string; message?: string; confirmLabel?: string; cancelLabel?: string;
  tone?: 'primary' | 'danger'; busy?: boolean; confirmDisabled?: boolean; children?: ReactNode; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={st.scrim}>
        <View style={st.dialog}>
          <IconTile icon={tone === 'danger' ? 'warning' : 'info'} tone={tone === 'danger' ? 'orange' : 'blue'} px={48} />
          <Text style={[type.h2 as TextStyle, { marginTop: 14 }]}>{title}</Text>
          {message ? <Text style={[st.mute, { marginTop: 6, fontSize: 14, lineHeight: 20 }]}>{message}</Text> : null}
          {children ? <View style={{ marginTop: 16 }}>{children}</View> : null}
          <View style={{ gap: 10, marginTop: 20 }}>
            <Button title={confirmLabel} variant={tone === 'danger' ? 'danger' : 'primary'} onPress={onConfirm} loading={busy} disabled={confirmDisabled} />
            <Button title={cancelLabel} variant="secondary" onPress={onCancel} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={st.empty}>
      <IconTile icon={icon} tone="blue" px={56} />
      <Text style={[type.h3 as TextStyle, { marginTop: 14, textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[st.mute, { marginTop: 4, textAlign: 'center', fontSize: 13 }]}>{message}</Text> : null}
      {action ? <View style={{ marginTop: 16, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card tone="emergency" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Icon name="warning" size={size.icon} color={colors.emergency} />
      <Text style={{ color: '#FFD2C7', flex: 1, fontSize: 13 }}>{message}</Text>
      {onRetry ? <Button title="Retry" variant="secondary" small full={false} onPress={onRetry} /> : null}
    </Card>
  );
}

// ───────────────────────── Styles ─────────────────────────
const st = StyleSheet.create({
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: 'rgba(8,13,32,0.92)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  mute: { color: colors.mute, fontSize: 13 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 16 },
  btn: { borderRadius: radius.lg - 4, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  btnText: { fontWeight: '800', letterSpacing: 0.1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 14, height: 36 },
  chipText: { color: colors.mute, fontSize: 13, fontWeight: '700' },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  label: { color: colors.mute, fontSize: 12, fontWeight: '700' },
  input: { flexDirection: 'row', alignItems: 'center', gap: 10, height: size.input, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg - 4, paddingHorizontal: 14 },
  inputText: { flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 0 },
  scrim: { flex: 1, backgroundColor: 'rgba(3,6,18,0.78)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, padding: 22 },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
});
