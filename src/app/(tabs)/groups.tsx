import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, IconTile, Screen, ScreenHeader, SectionHeader,
} from '../../components/ui';
import { colors } from '../../lib/theme';
import type { Group, GroupInvitation } from '../../lib/types';
import { deleteGroup, getMyGroupInvitations, getMyGroups, respondToGroupInvitation } from '../../services/groupsService';

const initial = (n: string) => n.trim().charAt(0).toUpperCase() || '?';

export default function MyGroups() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<GroupInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const [g, i] = await Promise.all([getMyGroups(), getMyGroupInvitations()]);
    if (g.ok) {
      setGroups(g.data);
      setError(null);
    } else {
      setError(g.error.message);
    }
    setInvites(i.ok ? i.data : []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function doDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const res = await deleteGroup(toDelete.id);
    setDeleting(false);
    if (!res.ok) {
      Alert.alert('Could not delete', res.error.message);
    } else {
      const id = toDelete.id;
      setGroups((list) => list.filter((x) => x.id !== id));
    }
    setToDelete(null);
  }

  async function respond(inv: GroupInvitation, accept: boolean) {
    const res = await respondToGroupInvitation(inv.member_id, accept);
    if (!res.ok) {
      Alert.alert('Could not answer', res.error.message);
      return;
    }
    load();
  }

  return (
    <Screen
      scroll
      tab
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <ScreenHeader title="Groups" subtitle="Family, friends, office and college. Nobody is notified until they accept their invitation." />

      <View style={{ gap: 10 }}>
        <Button title="Create New Group" icon="groupAdd" onPress={() => router.push('/group-edit')} />
        <Button title="Join with an invitation code" icon="link" variant="secondary" onPress={() => router.push('/join-group')} />
      </View>

      {invites.length > 0 && (
        <>
          <SectionHeader title="Invitations for you" />
          <View style={{ gap: 12 }}>
            {invites.map((inv) => (
              <Card key={inv.member_id} tone="selected" style={{ gap: 10 }}>
                <View style={s.row}>
                  <IconTile px={44} tone="blue"><Text style={{ fontSize: 22 }}>{inv.icon}</Text></IconTile>
                  <Text style={s.title} numberOfLines={1}>{inv.group_name}</Text>
                </View>
                <Text style={s.mute}>
                  {inv.invited_by} wants to add you to this group. If you accept, they can choose to notify you about their journeys. They never get your location.
                </Text>
                <View style={s.row}>
                  <Button title="Accept" small style={{ flex: 1 }} onPress={() => respond(inv, true)} />
                  <Button title="Decline" small variant="secondary" style={{ flex: 1 }} onPress={() => respond(inv, false)} />
                </View>
              </Card>
            ))}
          </View>
        </>
      )}

      <SectionHeader title="Your groups" />
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : error ? (
        <ErrorNote message={error} onRetry={() => { setLoading(true); load(); }} />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon="groups" title="No groups yet" message="Create a Family or Friends group, then pick it when you start a journey." />
        </Card>
      ) : (
        <View style={{ gap: 14 }}>
          {groups.map((g) => {
            const canEdit = g.my_role === 'owner' || g.my_role === 'admin';
            const count = g.member_count ?? 0;
            const preview = g.members_preview ?? [];
            const extra = count - preview.length;
            return (
              <Card key={g.id} style={{ gap: 12 }}>
                <View style={s.row}>
                  <IconTile px={48} tone="blue"><Text style={{ fontSize: 24 }}>{g.icon}</Text></IconTile>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.title} numberOfLines={1}>{g.name}</Text>
                    <Text style={s.mute}>
                      {count} {count === 1 ? 'member' : 'members'} · {g.accepted_count ?? 0} accepted
                    </Text>
                  </View>
                  {g.my_role && g.my_role !== 'owner' ? <Badge label={g.my_role} tone="neutral" /> : null}
                </View>

                {!!g.description && <Text style={s.mute} numberOfLines={2}>{g.description}</Text>}

                {preview.length > 0 && (
                  <View style={s.row}>
                    {preview.map((n, i) => (
                      <View key={i} style={[s.avatar, i > 0 && { marginLeft: -8 }]}>
                        <Text style={s.avatarText}>{initial(n)}</Text>
                      </View>
                    ))}
                    {extra > 0 && <Text style={[s.mute, { marginLeft: 6 }]}>+{extra}</Text>}
                  </View>
                )}

                <View style={s.row}>
                  <Button
                    title={canEdit ? 'Add Members' : 'View Members'}
                    icon={canEdit ? 'personAdd' : 'groups'}
                    small
                    style={{ flex: 1.4 }}
                    onPress={() => router.push({ pathname: '/group-members', params: { id: g.id } })}
                  />
                  {canEdit && (
                    <Button
                      title="Edit"
                      icon="edit"
                      small
                      variant="secondary"
                      style={{ flex: 1 }}
                      onPress={() => router.push({ pathname: '/group-edit', params: { id: g.id } })}
                    />
                  )}
                  {g.my_role === 'owner' && (
                    <Button title="Delete" icon="trash" small variant="secondary" full={false} onPress={() => setToDelete(g)} />
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <View style={{ height: 12 }} />
      <Button title="Your people" icon="contacts" variant="ghost" onPress={() => router.push('/contacts')} />

      <ConfirmModal
        visible={!!toDelete}
        tone="danger"
        title="Delete group?"
        message={`“${toDelete?.name ?? ''}” and its members and invitations will be removed. Journeys you already started are not affected.`}
        confirmLabel="Delete group"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.routeSoft, borderWidth: 2, borderColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accent, fontWeight: '800', fontSize: 12 },
});
