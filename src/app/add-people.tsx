import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Icon, IconTile, PersonAvatar, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { fmtDay } from '../lib/format';
import { colors, type } from '../lib/theme';
import { type Connection, getMyConnections, removeConnection, syncConnectionsToContacts } from '../services/connectionsService';
import { isMissingRpc } from '../services/privacyService';

export default function AddPeople() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Connection | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    const res = await getMyConnections();
    if (res.ok) {
      setConnections(res.data.connections);
      setError(null);
      syncConnectionsToContacts(); // keep the People list up to date in the background
    } else {
      setError(isMissingRpc(res.error) ? 'SETUP' : res.error.message);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function doRemove() {
    const c = toRemove;
    if (!c) return;
    setRemoving(true);
    const res = await removeConnection(c.user_id);
    setRemoving(false);
    setToRemove(null);
    if (!res.ok) return Alert.alert('Could not remove', res.error.message);
    setConnections((l) => l.filter((x) => x.user_id !== c.user_id));
  }

  return (
    <Screen scroll>
      <ScreenHeader title="Add People" subtitle="Connect in seconds with a QR code. No typing email addresses." onBack={() => router.back()} />

      <View style={{ gap: 14 }}>
        <Card tone="selected" style={s.option} onPress={() => router.push('/my-qr')}>
          <IconTile icon="qr" tone="blue" px={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.optionTitle}>Generate My QR Code</Text>
            <Text style={s.mute}>Show it to a friend so they can scan you.</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.accent} />
        </Card>
        <Card style={s.option} onPress={() => router.push('/scan-qr')}>
          <IconTile icon="scan" tone="green" px={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.optionTitle}>Scan QR Code</Text>
            <Text style={s.mute}>Scan a friend’s code with your camera.</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.dim} />
        </Card>
      </View>

      <Card tone="flat" style={s.info}>
        <Icon name="shieldCheck" size={18} color={colors.success} />
        <Text style={s.infoText}>
          Connecting only adds each other to your people. Nobody is notified and no location is shared until you invite them to a group or ask them to be an emergency contact.
        </Text>
      </Card>

      <SectionHeader title={connections.length ? `Connected by QR (${connections.length})` : 'Connected by QR'} />
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : error === 'SETUP' ? (
        <Card tone="flat" style={s.info}>
          <Icon name="info" size={18} color={colors.warning} />
          <Text style={[s.infoText, { color: colors.warning }]}>
            QR connections need a one-time database update. Run people-qr-backend.sql in your Supabase SQL Editor, then come back.
          </Text>
        </Card>
      ) : error ? (
        <ErrorNote message={error} onRetry={() => { setLoading(true); load(); }} />
      ) : connections.length === 0 ? (
        <Card>
          <EmptyState icon="personAdd" title="No one yet" message="People you connect with by QR code appear here." />
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
          {connections.map((c, i) => (
            <View key={c.user_id} style={[s.person, i < connections.length - 1 && s.line]}>
              <PersonAvatar name={c.name} url={c.avatar_url} px={42} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                <Badge label={`Connected ${fmtDay(c.connected_at).toLowerCase()}`} tone="green" caps={false} />
              </View>
              <Button title="Remove" icon="trash" small variant="secondary" full={false} onPress={() => setToRemove(c)} />
            </View>
          ))}
        </Card>
      )}

      <ConfirmModal
        visible={!!toRemove}
        tone="danger"
        title="Remove connection?"
        message={`You and ${toRemove?.name ?? 'this person'} will no longer be connected. You can connect again with a QR code.`}
        confirmLabel="Remove"
        busy={removing}
        onConfirm={doRemove}
        onCancel={() => setToRemove(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 },
  optionTitle: { ...type.h3, fontSize: 17 },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16 },
  infoText: { flex: 1, color: colors.mute, fontSize: 13, lineHeight: 19 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
});
