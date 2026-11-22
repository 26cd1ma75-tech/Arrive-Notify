import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Button, Card, EmptyState, Icon, IconTile, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { usePrefs } from '../lib/prefs';
import { colors } from '../lib/theme';
import type { Contact, Group } from '../lib/types';
import { getMyContacts, getMyGroups } from '../services/groupsService';

function Tick({ on }: { on: boolean }) {
  return on ? <Icon name="checkCircle" size={24} color={colors.accent} /> : <View style={s.ring} />;
}

export default function PrivacyRecipients() {
  const router = useRouter();
  const { prefs, update } = usePrefs();
  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  // Same choices Start Journey offers: groups you own and people who accepted
  useEffect(() => {
    (async () => {
      const [g, c] = await Promise.all([getMyGroups(), getMyContacts()]);
      if (g.ok) setGroups(g.data.filter((x) => x.my_role === 'owner'));
      if (c.ok) setPeople(c.data.filter((x) => x.accepted && x.user_id));
      setLoading(false);
    })();
  }, []);

  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const nothing = !loading && groups.length === 0 && people.length === 0;

  return (
    <Screen scroll>
      <ScreenHeader
        title="Who can see my journeys"
        subtitle="These people are pre-selected each time you start a journey. You can still change them every time."
        onBack={() => router.back()}
      />

      <Card tone="flat" style={s.info}>
        <Icon name="shieldCheck" size={18} color={colors.success} />
        <Text style={s.infoText}>Being selected only means they are notified. They can watch your live location only if you also switch on live sharing.</Text>
      </Card>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : nothing ? (
        <Card style={{ marginTop: 16 }}>
          <EmptyState
            icon="groups"
            title="No one to choose yet"
            message="Create a group or add people first. They must accept before they can be notified."
            action={<Button title="Create New Group" icon="groupAdd" variant="secondary" onPress={() => router.push('/group-edit')} />}
          />
        </Card>
      ) : (
        <>
          {groups.length > 0 && (
            <>
              <SectionHeader title="Groups" />
              <View style={{ gap: 10 }}>
                {groups.map((g) => {
                  const on = prefs.defaultGroupIds.includes(g.id);
                  return (
                    <Card key={g.id} tone={on ? 'selected' : 'default'} style={s.pick} onPress={() => update({ defaultGroupIds: flip(prefs.defaultGroupIds, g.id) })}>
                      <IconTile px={44} tone="blue"><Text style={{ fontSize: 22 }}>{g.icon}</Text></IconTile>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.name}>{g.name}</Text>
                        <Text style={s.mute}>{g.accepted_count ?? 0} accepted</Text>
                      </View>
                      <Tick on={on} />
                    </Card>
                  );
                })}
              </View>
            </>
          )}
          {people.length > 0 && (
            <>
              <SectionHeader title="People" />
              <View style={{ gap: 10 }}>
                {people.map((p) => {
                  const on = !!p.user_id && prefs.defaultPersonIds.includes(p.user_id);
                  return (
                    <Card key={p.user_id!} tone={on ? 'selected' : 'default'} style={s.pick} onPress={() => update({ defaultPersonIds: flip(prefs.defaultPersonIds, p.user_id!) })}>
                      <Avatar name={p.contact_name} px={44} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.name}>{p.contact_name}</Text>
                        <Text style={s.mute}>{p.contact_email ?? p.contact_phone}</Text>
                      </View>
                      <Tick on={on} />
                    </Card>
                  );
                })}
              </View>
            </>
          )}
          {(prefs.defaultGroupIds.length > 0 || prefs.defaultPersonIds.length > 0) && (
            <View style={{ marginTop: 20 }}>
              <Button title="Clear defaults" variant="secondary" onPress={() => update({ defaultGroupIds: [], defaultPersonIds: [] })} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { flex: 1, color: colors.mute, fontSize: 13, lineHeight: 19 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  mute: { color: colors.mute, fontSize: 13 },
  ring: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line },
});
