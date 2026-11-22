import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar, Button, Card, ConfirmModal, EmptyState, Icon, Input, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { colors } from '../lib/theme';
import { syncConnectionsToContacts } from '../services/connectionsService';

type Person = {
  contactId: string; // row id in the contacts table
  id: string; // the other user's id
  name: string | null;
  email: string | null;
};

export default function Contacts() {
  const router = useRouter();
  const { session } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Person | null>(null);

  const load = useCallback(async () => {
    await syncConnectionsToContacts(); // people added by QR appear in this list
    const { data: rows, error } = await supabase
      .from('contacts')
      .select('id, contact_user_id')
      .order('created_at', { ascending: false });
    if (error) {
      Alert.alert('Could not load people', error.message);
      setLoading(false);
      return;
    }
    const ids = (rows ?? []).map((r) => r.contact_user_id);
    let profs: { id: string; name: string | null; email: string | null }[] = [];
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id, name, email').in('id', ids);
      profs = data ?? [];
    }
    setPeople(
      (rows ?? []).map((r) => {
        const p = profs.find((x) => x.id === r.contact_user_id);
        return { contactId: r.id, id: r.contact_user_id, name: p?.name ?? null, email: p?.email ?? null };
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError(null);
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('find_user_by_email', { lookup: e });
      if (error) throw error;
      const found = (data as { id: string; name: string | null; email: string }[] | null)?.[0];
      if (!found) {
        setError('No Arrive Notify user has that email. Ask them to sign up in the app first.');
        return;
      }
      if (found.id === session?.user.id) {
        setError('That is your own email.');
        return;
      }
      const { error: insErr } = await supabase.from('contacts').insert({ contact_user_id: found.id });
      if (insErr) {
        setError(insErr.code === '23505' ? 'You already added this person.' : insErr.message);
        return;
      }
      setEmail('');
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    const p = toRemove;
    if (!p) return;
    setToRemove(null);
    const { error } = await supabase.from('contacts').delete().eq('id', p.contactId);
    if (error) Alert.alert('Could not remove', error.message);
    else setPeople((list) => list.filter((x) => x.contactId !== p.contactId));
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen scroll>
        <ScreenHeader title="Your people" subtitle="Add people by the email they used to sign up in Arrive Notify." onBack={() => router.back()} />

        <Button title="Add with QR code" icon="scan" onPress={() => router.push('/add-people')} />
        <Text style={[s.mute, { textAlign: 'center', marginVertical: 14 }]}>or add by email</Text>

        <Card style={{ gap: 12 }}>
          <Input
            icon="mail"
            placeholder="Their email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onSubmitEditing={add}
          />
          {error && (
            <View style={s.error}>
              <Icon name="warning" size={16} color={colors.emergency} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}
          <Button title="Add person" icon="personAdd" loading={busy} disabled={email.trim().length < 5} onPress={add} />
        </Card>

        <SectionHeader title={people.length ? `People (${people.length})` : 'People'} />
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
        ) : people.length === 0 ? (
          <Card>
            <EmptyState icon="contacts" title="No people yet" message="Add someone, like Mom or Dad." />
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {people.map((item, i) => (
              <View key={item.contactId} style={[s.row, i < people.length - 1 && s.line]}>
                <Avatar name={item.name ?? item.email} px={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{item.name ?? 'No name'}</Text>
                  <Text style={s.mute} numberOfLines={1}>{item.email}</Text>
                </View>
                <Button title="Remove" icon="trash" small variant="secondary" full={false} onPress={() => setToRemove(item)} />
              </View>
            ))}
          </Card>
        )}

        <ConfirmModal
          visible={!!toRemove}
          tone="danger"
          title="Remove person?"
          message={`Remove ${toRemove?.name ?? toRemove?.email ?? 'this person'} from your people?`}
          confirmLabel="Remove"
          onConfirm={doRemove}
          onCancel={() => setToRemove(null)}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  mute: { color: colors.mute, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#FFD2C7', fontSize: 13, lineHeight: 18 },
});
