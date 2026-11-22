import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Button, Card, ConfirmModal, Icon, Input, ListRow, Overline, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import {
  type DataSummary, deleteMyAccount, deleteMyJourneyHistory, exportMyData, getMyDataSummary, isMissingRpc,
} from '../services/privacyService';

const SETUP_MSG = 'This needs the privacy update. Run privacy-backend.sql once in your Supabase SQL Editor, then try again.';

export default function PrivacyData() {
  const router = useRouter();
  const { session } = useAuth();
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'history' | 'logout' | 'account'>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getMyDataSummary();
    setSummary(res.ok ? res.data : null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const failMsg = (title: string, e: { code: string; message: string }) =>
    Alert.alert(isMissingRpc(e) ? 'Update needed' : title, isMissingRpc(e) ? SETUP_MSG : e.message);

  async function download() {
    setExporting(true);
    const res = await exportMyData();
    setExporting(false);
    if (!res.ok) return failMsg('Could not export', res.error);
    try {
      await Share.share({ title: 'My Arrive Notify data', message: JSON.stringify(res.data.data, null, 2) });
    } catch {
      Alert.alert('Could not share', 'Your data was prepared but the share sheet could not open.');
    }
  }

  async function deleteHistory() {
    setBusy(true);
    const res = await deleteMyJourneyHistory();
    setBusy(false);
    setConfirm(null);
    if (!res.ok) return failMsg('Could not delete', res.error);
    Alert.alert('History deleted', `${res.data.deleted_journeys} finished ${res.data.deleted_journeys === 1 ? 'journey was' : 'journeys were'} removed.`);
    load();
  }

  async function deleteAccount() {
    setBusy(true);
    const res = await deleteMyAccount();
    setBusy(false);
    if (!res.ok) {
      setConfirm(null);
      return failMsg('Could not delete account', res.error);
    }
    setConfirm(null);
    await supabase.auth.signOut(); // the account is gone; clear the session on this phone
  }

  return (
    <Screen scroll>
      <ScreenHeader title="Your data & account" subtitle="See what is stored, take a copy, or delete it." onBack={() => router.back()} />

      <SectionHeader title="What is stored about you" />
      <Card style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
        ) : (
          <>
            <ListRow icon="journey" title="Journeys" subtitle="Destination, times and status" right={<Text style={s.count}>{summary?.journeys ?? '–'}</Text>} />
            <ListRow icon="gps" title="GPS points" subtitle="Recorded during journeys" right={<Text style={s.count}>{summary?.locationPoints ?? '–'}</Text>} />
            <ListRow icon="pin" title="Saved places" subtitle="Home, Office, College and more" right={<Text style={s.count}>{summary?.places ?? '–'}</Text>} last />
          </>
        )}
      </Card>

      <SectionHeader title="Your copy" />
      <Card style={{ gap: 10 }}>
        <Text style={s.body}>Get everything Arrive Notify holds about you (account, places, journeys, settings) as a text file you can save or send.</Text>
        <Button title="Download my data" icon="share" variant="secondary" loading={exporting} onPress={download} />
      </Card>

      <SectionHeader title="Delete" />
      <Card style={{ gap: 10 }}>
        <Text style={s.body}>Remove all finished journeys with their GPS points, recipients and alerts. Your saved places, groups and any journey that is running now are kept.</Text>
        <Button title="Delete my journey history" icon="trash" variant="secondary" onPress={() => setConfirm('history')} />
      </Card>

      <SectionHeader title="Account" />
      <Card style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
        <ListRow icon="mail" title="Signed in as" subtitle={session?.user.email ?? ''} />
        <ListRow icon="logout" tone="orange" title="Sign out of this device" subtitle="Stops alerts on this phone" onPress={() => setConfirm('logout')} last />
      </Card>

      <Card tone="emergency" style={{ marginTop: 20, gap: 10 }}>
        <Overline color={colors.emergency}>Danger zone</Overline>
        <Text style={s.dangerText}>Deleting your account permanently removes your profile, places, groups you own, journeys and settings. This cannot be undone.</Text>
        <Button title="Delete my account" icon="warning" variant="danger" onPress={() => { setTyped(''); setConfirm('account'); }} />
      </Card>

      <View style={s.note}>
        <Icon name="lock" size={14} color={colors.dim} />
        <Text style={s.noteText}>Only people you choose can see your location, and only during a journey you share.</Text>
      </View>

      <ConfirmModal
        visible={confirm === 'history'}
        tone="danger"
        title="Delete journey history?"
        message="All finished journeys and their GPS points are deleted. This cannot be undone."
        confirmLabel="Delete history"
        busy={busy}
        onConfirm={deleteHistory}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        visible={confirm === 'logout'}
        tone="danger"
        title="Sign out?"
        message="You will need to sign in again to start journeys or see alerts."
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirm(null);
          supabase.auth.signOut();
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        visible={confirm === 'account'}
        tone="danger"
        title="Delete your account?"
        message="Everything linked to your account is permanently deleted. Type DELETE to confirm."
        confirmLabel="Delete forever"
        busy={busy}
        confirmDisabled={typed.trim() !== 'DELETE'}
        onConfirm={deleteAccount}
        onCancel={() => setConfirm(null)}
      >
        <Input value={typed} onChangeText={setTyped} placeholder="Type DELETE" autoCapitalize="characters" autoCorrect={false} />
      </ConfirmModal>
    </Screen>
  );
}

const s = StyleSheet.create({
  count: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  body: { color: colors.mute, fontSize: 13, lineHeight: 19 },
  dangerText: { color: '#FFD2C7', fontSize: 13, lineHeight: 19 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 },
  noteText: { flex: 1, color: colors.dim, fontSize: 12, lineHeight: 17 },
});
