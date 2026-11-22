import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Alert, AlertButton, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Avatar, Badge, Button, Card, Chip, EmptyState, Icon, IconTile, Overline, Screen, ScreenHeader, SectionHeader, ToggleRow } from '../components/ui';
import { usePrefs } from '../lib/prefs';
import { colors } from '../lib/theme';
import { getMyContacts, getMyGroups } from '../services/groupsService';
import { cancelJourney, startQuickJourney } from '../services/journeyService';
import type { Contact, Group, Journey } from '../lib/types';

const TITLES: Record<string, string> = {
  LOCATION_PERMISSION_DENIED: 'Location permission needed',
  LOCATION_UNAVAILABLE: 'GPS unavailable',
  NETWORK_ERROR: 'No connection',
  UNAUTHENTICATED: 'Please log in again',
  PLACE_NOT_FOUND: 'Destination not found',
  GROUP_NOT_FOUND: 'Group not found',
  RECIPIENT_NOT_AUTHORIZED: 'Person not allowed',
};

function Tick({ on }: { on: boolean }) {
  return on ? <Icon name="checkCircle" size={24} color={colors.accent} /> : <View style={s.ring} />;
}

export default function NotifyBeforeStart() {
  const router = useRouter();
  const { placeId, placeName } = useLocalSearchParams<{ placeId: string; placeName?: string }>();

  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Contact[]>([]);
  const [selGroups, setSelGroups] = useState<string[]>([]);
  const [selPeople, setSelPeople] = useState<string[]>([]);
  const [shareLive, setShareLive] = useState(false); // OFF unless the traveller turns it on
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const { prefs, ready } = usePrefs();

  // "Share live location by default" (Privacy Settings)
  useEffect(() => {
    if (ready && prefs.defaultLiveShare) setShareLive(true);
  }, [ready, prefs.defaultLiveShare]);

  // Pre-select the default recipients from Privacy Settings, once, after the lists have loaded
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (!ready || loading || defaultsApplied.current) return;
    defaultsApplied.current = true;
    setSelGroups(prefs.defaultGroupIds.filter((id) => groups.some((g) => g.id === id)));
    setSelPeople(prefs.defaultPersonIds.filter((id) => people.some((p) => p.user_id === id)));
  }, [ready, loading, groups, people, prefs.defaultGroupIds, prefs.defaultPersonIds]);

  useEffect(() => {
    (async () => {
      const [g, c] = await Promise.all([getMyGroups(), getMyContacts()]);
      if (g.ok) setGroups(g.data.filter((x) => x.my_role === 'owner'));
      // individuals: only people who accepted an invitation and have an account
      if (c.ok) setPeople(c.data.filter((x) => x.accepted && x.user_id));
      setLoading(false);
    })();
  }, []);

  const toggle = (list: string[], v: string, set: (l: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const chosen = groups.filter((g) => selGroups.includes(g.id));
  const accepted = chosen.reduce((n, g) => n + (g.accepted_count ?? 0), 0);
  const waiting = chosen.reduce((n, g) => n + ((g.member_count ?? 0) - (g.accepted_count ?? 0)), 0);

  async function start() {
    setStarting(true);
    const wantsLive = shareLive && (selGroups.length > 0 || selPeople.length > 0);
    const res = await startQuickJourney(String(placeId), {
      groupIds: selGroups,
      shareLive: wantsLive,
      recipients: people
        .filter((p) => p.user_id && selPeople.includes(p.user_id))
        .map((p) => ({ recipient_id: p.user_id, recipient_name: p.contact_name })),
    });
    setStarting(false);

    if (res.ok) {
      const go = () => router.replace({ pathname: '/journey', params: { id: res.data.journey.id } });
      if (wantsLive && !res.data.sharing_live) {
        Alert.alert(
          'Live sharing is off',
          'None of the people you chose has an Arrive Notify account that accepted your invitation, so nobody can watch this journey yet.',
          [{ text: 'OK', onPress: go }]
        );
      } else {
        go();
      }
      return;
    }
    const err = res.error;
    if (err.code === 'ACTIVE_JOURNEY_EXISTS') {
      const current = err.details?.journey as Journey | undefined;
      const buttons: AlertButton[] = [];
      if (current) {
        buttons.push({ text: 'Continue it', onPress: () => router.replace({ pathname: '/journey', params: { id: current.id } }) });
        buttons.push({
          text: 'Cancel it, start new',
          style: 'destructive',
          onPress: async () => {
            const c = await cancelJourney(current.id);
            if (!c.ok) return Alert.alert('Could not cancel', c.error.message);
            start();
          },
        });
      }
      buttons.push({ text: 'Keep it', style: 'cancel' });
      Alert.alert('Journey already active', `You already have an active journey to ${current?.destination_name ?? 'another place'}.`, buttons);
      return;
    }
    Alert.alert(TITLES[err.code] ?? 'Could not start journey', err.message);
  }

  const nobody = selGroups.length === 0 && selPeople.length === 0;
  const count = accepted + selPeople.length;

  return (
    <Screen
      scroll
      footer={
        <Button
          title={nobody ? 'Start journey (notify no one)' : 'Start Journey'}
          icon="journey"
          loading={starting}
          disabled={loading}
          onPress={start}
        />
      }
    >
      <ScreenHeader title="Start Journey" subtitle="Choose who should be notified." onBack={() => router.back()} />

      <Card style={s.target}>
        <IconTile icon="pin" tone="blue" />
        <View style={{ flex: 1, gap: 4 }}>
          <Overline>Destination</Overline>
          <Text style={s.targetName} numberOfLines={1}>{placeName ?? 'Destination'}</Text>
        </View>
      </Card>

      <SectionHeader title="Who should be notified?" />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : (
        <View style={{ gap: 10 }}>
          {groups.length === 0 && (
            <Card>
              <EmptyState
                icon="groups"
                title="No groups yet"
                message="You can still start the journey, or create a group first."
                action={<Button title="Create New Group" icon="groupAdd" variant="secondary" onPress={() => router.push('/group-edit')} />}
              />
            </Card>
          )}

          {groups.map((g) => {
            const on = selGroups.includes(g.id);
            const wait = (g.member_count ?? 0) - (g.accepted_count ?? 0);
            return (
              <Card key={g.id} tone={on ? 'selected' : 'default'} style={s.pick} onPress={() => toggle(selGroups, g.id, setSelGroups)}>
                <IconTile px={44} tone="blue"><Text style={{ fontSize: 22 }}>{g.icon}</Text></IconTile>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.name}>{g.name}</Text>
                  <Text style={s.mute}>{g.accepted_count ?? 0} accepted{wait > 0 ? ` · ${wait} waiting (will not be notified)` : ''}</Text>
                </View>
                <Tick on={on} />
              </Card>
            );
          })}

          {people.length > 0 && (
            <>
              <Text style={[s.sub, { marginTop: 10 }]}>Or individual people</Text>
              {people.map((p) => {
                const on = !!p.user_id && selPeople.includes(p.user_id);
                return (
                  <Card key={p.user_id!} tone={on ? 'selected' : 'default'} style={s.pick} onPress={() => toggle(selPeople, p.user_id!, setSelPeople)}>
                    <Avatar name={p.contact_name} px={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.name}>{p.contact_name}</Text>
                      <Text style={s.mute}>{p.contact_email ?? p.contact_phone}</Text>
                    </View>
                    <Tick on={on} />
                  </Card>
                );
              })}
            </>
          )}

          <Card style={{ paddingVertical: 4, paddingHorizontal: 14, marginTop: 10 }}>
            <ToggleRow
              icon="radar"
              title="Share my live location"
              subtitle="Lets the people above watch your position, route and arrival time while this journey is active. They never see your past locations, and sharing stops when the journey ends. You can stop it at any time."
              value={shareLive && !nobody}
              onValueChange={setShareLive}
              disabled={nobody}
              last
            />
          </Card>

          <Card style={{ gap: 12 }}>
            <View style={s.milestoneHead}>
              <Text style={s.name}>Arrival triggers</Text>
              <Badge label={nobody ? 'No one selected' : `${count} ${count === 1 ? 'person' : 'people'}`} tone={nobody ? 'neutral' : 'blue'} caps={false} />
            </View>
            <View style={s.chips}>
              <Chip label="When I leave" icon="checkCircle" selected />
              <Chip label="About 10 min away" icon="checkCircle" selected />
              <Chip label="When I arrive" icon="checkCircle" selected />
            </View>
            <Text style={s.mute}>
              {nobody
                ? 'No one is selected, so nobody will be notified about this journey.'
                : `Up to ${count} ${count === 1 ? 'person' : 'people'} will get an arrival message${waiting > 0 ? `. ${waiting} still waiting to accept will be skipped` : ''}.`}
            </Text>
            <Text style={s.mute}>
              Each person gets an update inside the app when the journey starts, when you are about 10 minutes away, and when you arrive or cancel. Push and SMS are not set up yet. Your location is shared only if you switch it on above.
            </Text>
          </Card>
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  target: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  targetName: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  sub: { color: colors.mute, fontSize: 13, fontWeight: '700' },
  ring: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line },
  milestoneHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
