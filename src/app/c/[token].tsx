import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge, Button, Card, Icon, IconTile, PersonAvatar, PulseDot, Screen } from '../../components/ui';
import { colors, type } from '../../lib/theme';
import { acceptQrConnection, previewQr, type QrPreview, syncConnectionsToContacts } from '../../services/connectionsService';
import { isMissingRpc } from '../../services/privacyService';

// Opened after a scan, or from a shared invite link (arrivenotify://c/<token>)
export default function ConfirmPerson() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'done'>('loading');
  const [preview, setPreview] = useState<QrPreview | null>(null);
  const [error, setError] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [wasAlready, setWasAlready] = useState(false);

  const pop = useRef(new Animated.Value(0)).current;
  const play = () => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await previewQr(String(token ?? ''));
      if (cancelled) return;
      if (res.ok) {
        setPreview(res.data);
        setPhase('ready');
        play();
      } else {
        setError(isMissingRpc(res.error) ? 'QR connections need a one-time database update. Run people-qr-backend.sql in your Supabase SQL Editor.' : res.error.message);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    setAdding(true);
    const res = await acceptQrConnection(String(token ?? ''));
    setAdding(false);
    if (!res.ok) {
      setError(res.error.message);
      setPhase('error');
      return;
    }
    setPreview(res.data);
    setWasAlready(res.data.already_connected);
    await syncConnectionsToContacts(); // show them in Your people right away
    setPhase('done');
    play();
  }

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  if (phase === 'loading') {
    return (
      <Screen>
        <View style={s.center}>
          <PulseDot color={colors.accent} />
          <Text style={s.mute}>Checking this QR code…</Text>
        </View>
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen
        footer={
          <View style={{ gap: 10 }}>
            <Button title="Scan again" icon="scan" onPress={() => router.replace('/scan-qr')} />
            <Button title="Back" variant="secondary" onPress={() => router.replace('/add-people')} />
          </View>
        }
      >
        <View style={s.center}>
          <IconTile icon="warning" tone="orange" px={64} />
          <Text style={[type.h2, { textAlign: 'center' }]}>Cannot add this person</Text>
          <Text style={[s.mute, { textAlign: 'center' }]}>{error}</Text>
        </View>
      </Screen>
    );
  }

  if (phase === 'done' && preview) {
    return (
      <Screen
        footer={
          <View style={{ gap: 10 }}>
            <Button title="Done" onPress={() => router.replace('/add-people')} />
            <Button title="Scan another" icon="scan" variant="secondary" onPress={() => router.replace('/scan-qr')} />
          </View>
        }
      >
        <View style={s.center}>
          <Animated.View style={[s.ring, { borderColor: colors.success, backgroundColor: colors.successSoft, transform: [{ scale }] }]}>
            <Icon name="check" size={52} color={colors.success} />
          </Animated.View>
          <Text style={[type.display, { textAlign: 'center' }]}>{wasAlready ? 'Already connected' : 'Person added!'}</Text>
          <Text style={[s.mute, { textAlign: 'center', fontSize: 15 }]}>
            {wasAlready ? `You and ${preview.person.name} are already connected.` : `${preview.person.name} is now in your people.`}
          </Text>
          <Text style={[s.mute, { textAlign: 'center', marginTop: 4 }]}>
            Invite them to a group, or ask them to be an emergency contact, whenever you are ready.
          </Text>
        </View>
      </Screen>
    );
  }

  const person = preview?.person;
  return (
    <Screen
      footer={
        <View style={{ gap: 10 }}>
          {preview?.already_connected ? (
            <Button title="Done" onPress={() => router.replace('/add-people')} />
          ) : (
            <Button title="Add Person" icon="personAdd" loading={adding} onPress={add} />
          )}
          <Button title="Cancel" variant="secondary" disabled={adding} onPress={() => router.replace('/add-people')} />
        </View>
      }
    >
      <View style={s.center}>
        <Animated.View style={[s.glow, { transform: [{ scale }] }]}>
          <PersonAvatar name={person?.name} url={person?.avatar_url} px={104} />
        </Animated.View>
        <Text style={[type.h1, { textAlign: 'center' }]} numberOfLines={2}>{person?.name}</Text>
        <Badge label={preview?.already_connected ? 'Already connected' : 'Arrive Notify user'} tone={preview?.already_connected ? 'green' : 'blue'} icon={preview?.already_connected ? 'checkCircle' : 'shieldCheck'} caps={false} />
        <Card tone="flat" style={{ marginTop: 10 }}>
          <Text style={[s.mute, { textAlign: 'center' }]}>
            {preview?.already_connected
              ? 'You are already connected, so there is nothing more to do.'
              : `Add ${person?.name} to your people? You will both be connected. Nothing is shared until you invite each other to something.`}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  mute: { color: colors.mute, fontSize: 14, lineHeight: 20 },
  glow: { padding: 6, borderRadius: 70, borderWidth: 2, borderColor: colors.route, shadowColor: colors.route, shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  ring: { width: 116, height: 116, borderRadius: 58, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
});
