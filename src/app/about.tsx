import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Card, Icon, IconName, IconTile, Overline, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { colors, type } from '../lib/theme';
import { routingAttribution } from '../services/routingService';

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'pin', title: 'Pick a destination', body: 'Choose Home, Office, College or any saved place, and who should know.' },
  { icon: 'radar', title: 'Travel as normal', body: 'Your chosen people are told when you start and can follow along if you allow it.' },
  { icon: 'shieldCheck', title: 'Arrive and stop sharing', body: 'When you reach the destination, they are told and live sharing ends.' },
];

export default function About() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen scroll>
      <ScreenHeader title="About" onBack={() => router.back()} />

      <Card style={s.hero}>
        <IconTile icon="pin" tone="blue" px={64} />
        <Text style={[type.display, { marginTop: 16, textAlign: 'center' }]}>Don’t text.</Text>
        <Text style={[type.display, { color: colors.accent, textAlign: 'center' }]}>Just arrive.</Text>
        <Text style={s.mute}>Arrive Notify tells the people you choose when you set off and when you get there.</Text>
        <View style={{ marginTop: 14 }}>
          <Overline>Version {version}</Overline>
        </View>
      </Card>

      <SectionHeader title="How it works" />
      <View style={{ gap: 12 }}>
        {STEPS.map((st, i) => (
          <Card key={st.title} style={s.step}>
            <IconTile icon={st.icon} tone={i === 2 ? 'green' : 'blue'} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>{st.title}</Text>
              <Text style={s.mute}>{st.body}</Text>
            </View>
          </Card>
        ))}
      </View>

      <Card tone="flat" style={{ marginTop: 20, flexDirection: 'row', gap: 10 }}>
        <Icon name="info" size={18} color={colors.dim} />
        <Text style={[s.mute, { flex: 1, textAlign: 'left' }]}>{routingAttribution}</Text>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 28 },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 2 },
});
