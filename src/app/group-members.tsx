import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Share, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { Avatar, Badge, Button, Card, Chip, ConfirmModal, EmptyState, Icon, IconTile, Input, PulseDot, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { colors, type } from '../lib/theme';
import {
  addGroupMember, getGroupDetails, inviteGroupMember, removeGroupMember, updateGroupMember,
} from '../services/groupsService';
import type { Group, GroupMember, GroupRole } from '../lib/types';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'orange'> = { accepted: 'green', pending: 'amber', declined: 'orange' };

export default function GroupMembers() {
  const router = useRouter();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [group, setGroup] = useState<Group | null>(null);
  const [role, setRole] = useState<GroupRole | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<GroupMember | null>(null);

  // add form
  const [aName, setAName] = useState('');
  const [aEmail, setAEmail] = useState('');
  const [aPhone, setAPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // inline editor
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [ePhone, setEPhone] = useState('');
  const [eAdmin, setEAdmin] = useState(false);

  const canManage = role === 'owner' || role === 'admin';

  const load = useCallback(async () => {
    const res = await getGroupDetails(String(id));
    if (!res.ok) {
      setError(res.error.message);
    } else {
      setError(null);
      setGroup(res.data.group);
      setRole(res.data.my_role);
      setMembers(res.data.members);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function add() {
    setFormError(null);
    if (!aName.trim()) return setFormError('Enter the person\'s name.');
    if (!aEmail.trim() && !aPhone.trim()) return setFormError('Enter an email address or phone number.');
    setAdding(true);
    const res = await addGroupMember(String(id), {
      contact_name: aName.trim(),
      contact_email: aEmail.trim() || null,
      contact_phone: aPhone.trim() || null,
    });
    setAdding(false);
    if (!res.ok) return setFormError(res.error.message);
    setAName('');
    setAEmail('');
    setAPhone('');
    Alert.alert(
      'Person added',
      res.data.registered
        ? 'They already have Arrive Notify. They will see your invitation inside the app and must accept it.'
        : 'They do not have the app yet. Tap Invite next to their name to share an invitation link.'
    );
    load();
  }

  async function invite(m: GroupMember) {
    setBusyId(m.id);
    const res = await inviteGroupMember(String(id), m.id);
    setBusyId(null);
    if (!res.ok) {
      Alert.alert('Could not create invitation', res.error.message);
      return;
    }
    const url = Linking.createURL('join-group', { queryParams: { token: res.data.token } });
    const days = Math.round((new Date(res.data.invitation.expires_at).getTime() - Date.now()) / 86400000);
    await Share.share({
      message:
        `You are invited to join "${group?.name}" on Arrive Notify.\n\n` +
        `Open this link: ${url}\n\n` +
        `Or open the app, go to Groups > Join with an invitation code, and enter this code:\n${res.data.token}\n\n` +
        `The invitation works once and expires in about ${days} days.`,
    });
  }

  async function doRemove() {
    const m = toRemove;
    if (!m) return;
    const self = !!m.user_id && m.user_id === session?.user.id;
    setToRemove(null);
    const res = await removeGroupMember(String(id), m.id);
    if (!res.ok) return Alert.alert('Could not remove', res.error.message);
    if (self) router.replace('/groups');
    else setMembers((l) => l.filter((x) => x.id !== m.id));
  }

  function startEdit(m: GroupMember) {
    setEditId(m.id);
    setEName(m.contact_name);
    setEPhone(m.contact_phone ?? '');
    setEAdmin(m.role === 'admin');
  }

  async function saveEdit(m: GroupMember) {
    const patch: { name?: string; phone?: string; role?: 'admin' | 'member' } = { name: eName, phone: ePhone };
    if (role === 'owner') patch.role = eAdmin ? 'admin' : 'member';
    const res = await updateGroupMember(String(id), m.id, patch);
    if (!res.ok) return Alert.alert('Could not save', res.error.message);
    setEditId(null);
    load();
  }

  if (loading) {
    return (
      <Screen>
        <View style={s.center}>
          <PulseDot color={colors.accent} />
        </View>
      </Screen>
    );
  }
  if (error || !group) {
    return (
      <Screen>
        <View style={s.center}>
          <Text style={type.h2}>Could not open this group</Text>
          <Text style={[s.mute, { textAlign: 'center' }]}>{error ?? 'Group not found.'}</Text>
          <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
            <Button title="Back" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  const removingSelf = !!toRemove?.user_id && toRemove.user_id === session?.user.id;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen scroll>
        <ScreenHeader
          title={group.name}
          subtitle={`${group.description ? `${group.description}\n` : ''}Your role: ${role}. People only get arrival messages after they accept.`}
          onBack={() => router.back()}
          right={<IconTile px={44} tone="blue"><Text style={{ fontSize: 22 }}>{group.icon}</Text></IconTile>}
        />

        {canManage && (
          <Card style={{ gap: 12 }}>
            <Text style={s.panelTitle}>Add a member</Text>
            <Input icon="profile" placeholder="Name" value={aName} onChangeText={setAName} />
            <Input icon="mail" placeholder="Email" value={aEmail} onChangeText={setAEmail} autoCapitalize="none" keyboardType="email-address" />
            <Input icon="call" placeholder="Phone (optional)" value={aPhone} onChangeText={setAPhone} keyboardType="phone-pad" />
            {formError && (
              <View style={s.error}>
                <Icon name="warning" size={16} color={colors.emergency} />
                <Text style={s.errorText}>{formError}</Text>
              </View>
            )}
            <Button title="Add member" icon="personAdd" loading={adding} onPress={add} />
          </Card>
        )}

        <SectionHeader title={`Members (${members.length})`} />
        {members.length === 0 && (
          <Card>
            <EmptyState icon="groups" title="No members yet" />
          </Card>
        )}
        <View style={{ gap: 12 }}>
          {members.map((m) => {
            const mine = !!m.user_id && m.user_id === session?.user.id;
            const canRemoveThis = mine || role === 'owner' || (role === 'admin' && m.role !== 'admin');
            return (
              <Card key={m.id} style={{ gap: 12 }}>
                <View style={s.row}>
                  <Avatar name={m.contact_name} px={44} tone={m.invitation_status === 'accepted' ? 'green' : 'blue'} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.name} numberOfLines={1}>
                      {m.contact_name}
                      {m.role === 'admin' ? '  (admin)' : ''}
                    </Text>
                    {canManage && <Text style={s.mute} numberOfLines={1}>{m.contact_email ?? m.contact_phone ?? ''}</Text>}
                  </View>
                  <Badge label={m.invitation_status} tone={STATUS_TONE[m.invitation_status] ?? 'neutral'} caps={false} />
                </View>

                {canManage && m.invitation_status === 'pending' && !m.registered && (
                  <Button title="Invite (share link or code)" icon="share" variant="secondary" small loading={busyId === m.id} onPress={() => invite(m)} />
                )}
                {canManage && m.invitation_status === 'pending' && m.registered && (
                  <Text style={s.mute}>Waiting for them to accept inside the app.</Text>
                )}

                {editId === m.id ? (
                  <View style={{ gap: 10 }}>
                    <Input value={eName} onChangeText={setEName} placeholder="Name" />
                    <Input value={ePhone} onChangeText={setEPhone} placeholder="Phone" keyboardType="phone-pad" />
                    {role === 'owner' && (
                      <View style={{ flexDirection: 'row' }}>
                        <Chip label={eAdmin ? 'Admin' : 'Make admin'} icon="shieldCheck" selected={eAdmin} onPress={() => setEAdmin(!eAdmin)} />
                      </View>
                    )}
                    <View style={s.row}>
                      <Button title="Save" small style={{ flex: 1 }} onPress={() => saveEdit(m)} />
                      <Button title="Cancel" small variant="secondary" style={{ flex: 1 }} onPress={() => setEditId(null)} />
                    </View>
                  </View>
                ) : (
                  <View style={s.row}>
                    {canManage && <Button title="Edit" icon="edit" small variant="secondary" style={{ flex: 1 }} onPress={() => startEdit(m)} />}
                    {canRemoveThis && (
                      <Button title={mine ? 'Leave' : 'Remove'} icon={mine ? 'logout' : 'trash'} small variant="secondary" style={{ flex: 1 }} onPress={() => setToRemove(m)} />
                    )}
                  </View>
                )}
              </Card>
            );
          })}
        </View>

        <ConfirmModal
          visible={!!toRemove}
          tone="danger"
          title={removingSelf ? 'Leave group?' : 'Remove member?'}
          message={removingSelf ? 'You will no longer be part of this group.' : `Remove ${toRemove?.contact_name ?? 'this person'} from the group?`}
          confirmLabel={removingSelf ? 'Leave' : 'Remove'}
          onConfirm={doRemove}
          onCancel={() => setToRemove(null)}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  panelTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#FFD2C7', fontSize: 13, lineHeight: 18 },
});
