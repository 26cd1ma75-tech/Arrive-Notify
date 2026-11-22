import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Card, ListRow, Screen, ScreenHeader, SectionHeader, ToggleRow } from '../components/ui';
import { usePrefs } from '../lib/prefs';
import { colors } from '../lib/theme';

export default function NotificationSettings() {
  const router = useRouter();
  const { prefs, update } = usePrefs();
  const off = !prefs.journeyUpdates;

  return (
    <Screen scroll>
      <ScreenHeader title="Notification Settings" subtitle="Choose which alerts you see in the app." onBack={() => router.back()} />

      <SectionHeader title="Journey updates" />
      <Card style={s.list}>
        <ToggleRow
          icon="bell"
          title="Journey updates"
          subtitle="Alerts about journeys that people share with you"
          value={prefs.journeyUpdates}
          onValueChange={(v) => update({ journeyUpdates: v })}
        />
        <ToggleRow icon="journey" title="Someone starts a journey" value={prefs.notifyStarted} disabled={off} onValueChange={(v) => update({ notifyStarted: v })} />
        <ToggleRow icon="clock" title="Someone is about 10 minutes away" value={prefs.notifyNearby} disabled={off} onValueChange={(v) => update({ notifyNearby: v })} />
        <ToggleRow icon="checkCircle" tone="green" title="Someone arrives" value={prefs.notifyArrived} disabled={off} onValueChange={(v) => update({ notifyArrived: v })} />
        <ToggleRow icon="cancel" tone="amber" title="A journey is cancelled" value={prefs.notifyCancelled} disabled={off} onValueChange={(v) => update({ notifyCancelled: v })} last />
      </Card>

      <SectionHeader title="Emergencies" />
      <Card style={s.list}>
        <ListRow
          icon="sos"
          tone="orange"
          title="Emergency alerts"
          subtitle="Always on. SOS alerts from people who chose you are never hidden."
          right={<Text style={s.on}>ON</Text>}
          last
        />
      </Card>

      <Card tone="flat" style={{ marginTop: 20 }}>
        <Text style={s.note}>
          Alerts appear inside Arrive Notify while the app is open. Push notifications to a locked phone are not available yet. Sharing defaults and retention are in Privacy Settings.
        </Text>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  list: { paddingVertical: 4, paddingHorizontal: 14 },
  on: { color: colors.emergency, fontSize: 12, fontWeight: '800' },
  note: { color: colors.mute, fontSize: 13, lineHeight: 19 },
});
