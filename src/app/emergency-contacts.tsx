import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Avatar, Badge, Button, Card, ConfirmModal, EmptyState, Icon, Input, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { colors } from '../lib/theme';
import {
  getEmergencyRequests, getMyEmergencyContacts, removeEmergencyContact, requestEmergencyContact, respondEmergencyRequest,
} from '../services/sosService';
import { getMyContacts } from '../services/groupsService';
import type { Contact, EmergencyContact, EmergencyRequest } from '../lib/types';
import { type Connection, getMyConnections } from '../services/connectionsService';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'orange' }> = {
  accepted: { label: 'Accepted', tone: 'green' },
  pending: { label: 'Waiting', tone: 'amber' },
  declined: { label: 'Declined', tone: 'orange' },
};

export default function EmergencyContacts() {
  const router = useRouter();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [people, setPeople] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<EmergencyContact | null>(null);
  const [qrPeople, setQrPeople] = useState<Connection[]>([]);

  const load = useCallback(async () => {
    const [c, r, p, q] = await Promise.all([getMyEmergencyContacts(), getEmergencyRequests(), getMyContacts(), getMyConnections()]);
    if (c.ok) setContacts(c.data);
    else setError(c.error.message);
    if (r.ok) setRequests(r.data);
    if (p.ok) setPeople(p.data.filter((x) => x.accepted && x.user_id));
    setQrPeople(q.ok ? q.data.connections : []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function addByEmail() {
    setError(null);
    setBusy(true);
    const res = await requestEmergencyContact({ email });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setEmail('');
    Alert.alert('Request sent', 'They will see your request inside Arrive Notify. They only receive SOS alerts after they accept.');
    load();
  }

  async function addPerson(p: Contact) {
    setError(null);
    const res = await requestEmergencyContact({ userId: p.user_id as string });
    if (!res.ok) return setError(res.error.message);
    load();
  }

  async function addConnection(c: Connection) {
    setError(null);
    const res = await requestEmergencyContact({ userId: c.user_id });
    if (!res.ok) return setError(res.error.message);
    load();
  }

  async function answer(r: EmergencyRequest, accept: boolean) {
    const res = await respondEmergencyRequest(r.id, accept);
    if (!res.ok) return Alert.alert('Could not answer', res.error.message);
    load();
  }

  async function doRemove() {
    const c = toRemove;
    if (!c) return;
    setToRemove(null);
    const res = await removeEmergencyContact(c.id);
    if (!res.ok) return Alert.alert('Could not remove', res.error.message);
    setContacts((l) => l.filter((x) => x.id !== c.id));
  }

  const known = new Set(contacts.map((c) => c.contact_user_id));
  const suggestions = people.filter((p) => p.user_id && !known.has(p.user_id));
  const qrSuggestions = qrPeople.filter((c) => !known.has(c.user_id) && !suggestions.some((p) => p.user_id === c.user_id));

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <ScreenHeader
        title="Emergency contacts"
        subtitle="These people receive your SOS alerts and your latest location. Each person must accept first, and can leave at any time."
        onBack={() => router.back()}
      />

      {requests.length > 0 && (
        <>
          <SectionHeader title="Requests for you" />
          <View style={{ gap: 12 }}>
            {requests.map((r) => (
              <Card key={r.id} tone="selected" style={{ gap: 10 }}>
                <Text style={s.name}>{r.from_name} wants you as an emergency contact</Text>
                <Text style={s.mute}>
                  If you accept, you will get their SOS alerts with their location, and you can answer "seen" or "on my way". You can leave at any time.
                </Text>
                <View style={s.row}>
                  <Button title="Accept" small style={{ flex: 1 }} onPress={() => answer(r, true)} />
                  <Button title="Decline" small variant="secondary" style={{ flex: 1 }} onPress={() => answer(r, false)} />
                </View>
              </Card>
            ))}
          </View>
        </>
      )}

      <SectionHeader title="Add by email" />
      <Card style={{ gap: 12 }}>
        <Input
          icon="mail"
          placeholder="Their Arrive Notify email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        {error && (
          <View style={s.error}>
            <Icon name="warning" size={16} color={colors.emergency} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}
        <Button title="Send request" icon="send" loading={busy} disabled={email.trim().length < 5} onPress={addByEmail} />
      </Card>

      {qrSuggestions.length > 0 && (
        <>
          <SectionHeader title="People you connected with by QR" />
          <Card style={{ paddingVertical: 4 }}>
            {qrSuggestions.map((c, i) => (
              <View key={c.user_id} style={[s.person, i < qrSuggestions.length - 1 && s.line]}>
                <Avatar name={c.name} px={36} />
                <Text style={[s.name, { flex: 1 }]}>{c.name}</Text>
                <Button title="Ask" small full={false} onPress={() => addConnection(c)} />
              </View>
            ))}
          </Card>
        </>
      )}

      {suggestions.length > 0 && (
        <>
          <SectionHeader title="From your groups" />
          <Card style={{ paddingVertical: 4 }}>
            {suggestions.map((p, i) => (
              <View key={p.user_id} style={[s.person, i < suggestions.length - 1 && s.line]}>
                <Avatar name={p.contact_name} px={36} />
                <Text style={[s.name, { flex: 1 }]}>{p.contact_name}</Text>
                <Button title="Ask" small full={false} onPress={() => addPerson(p)} />
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionHeader title="Your emergency contacts" />
      {loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : contacts.length === 0 ? (
        <Card>
          <EmptyState icon="call" title="No emergency contacts yet" message="Add someone above. They only receive SOS alerts after they accept." />
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {contacts.map((c, i) => {
            const st = STATUS[c.status] ?? STATUS.pending;
            return (
              <View key={c.id} style={[s.person, i < contacts.length - 1 && s.line]}>
                <Avatar name={c.name} px={36} tone={c.status === 'accepted' ? 'green' : 'blue'} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.name}>{c.name}</Text>
                  <Badge label={st.label} tone={st.tone} caps={false} />
                </View>
                <Button title="Remove" icon="trash" small variant="secondary" full={false} onPress={() => setToRemove(c)} />
              </View>
            );
          })}
        </Card>
      )}

      <ConfirmModal
        visible={!!toRemove}
        tone="danger"
        title="Remove emergency contact?"
        message={`${toRemove?.name ?? 'This person'} will no longer receive your SOS alerts.`}
        confirmLabel="Remove"
        onConfirm={doRemove}
        onCancel={() => setToRemove(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#FFD2C7', fontSize: 13, lineHeight: 18 },
});
