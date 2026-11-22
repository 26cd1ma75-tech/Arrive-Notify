import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Avatar, Button, Card, Chip, Icon, Input, Overline, PulseDot, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { colors, radius } from '../lib/theme';
import { GROUP_CATEGORIES, GROUP_ICONS, categoryIcon } from '../lib/groupIcons';
import { createGroup, getGroupDetails, getMyContacts, updateGroup } from '../services/groupsService';
import type { Contact, GroupCategory, MemberInput } from '../lib/types';

const memberKey = (m: MemberInput) => (m.contact_email?.toLowerCase() || m.contact_phone || m.contact_name).trim();

export default function GroupEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GroupCategory>('family');
  const [icon, setIcon] = useState(categoryIcon('family'));
  const [iconTouched, setIconTouched] = useState(false);
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (editing) {
        const res = await getGroupDetails(String(id));
        if (!res.ok) {
          setError(res.error.message);
        } else {
          setName(res.data.group.name);
          setDescription(res.data.group.description ?? '');
          setCategory(res.data.group.category);
          setIcon(res.data.group.icon);
          setIconTouched(true);
        }
        setLoading(false);
      } else {
        const c = await getMyContacts();
        if (c.ok) setContacts(c.data);
      }
    })();
  }, [id, editing]);

  function pickCategory(c: GroupCategory) {
    setCategory(c);
    if (!iconTouched) setIcon(categoryIcon(c));
  }

  function addDraft(m: MemberInput) {
    if (members.some((x) => memberKey(x) === memberKey(m))) {
      setError('That person is already in the list.');
      return;
    }
    setError(null);
    setMembers((list) => [...list, m]);
  }

  function addManual() {
    const n = mName.trim();
    if (!n) return setError('Enter the person\'s name.');
    if (!mEmail.trim() && !mPhone.trim()) return setError('Enter an email address or phone number.');
    addDraft({ contact_name: n, contact_email: mEmail.trim() || null, contact_phone: mPhone.trim() || null });
    setMName('');
    setMEmail('');
    setMPhone('');
  }

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.contact_name.toLowerCase().includes(q) || (c.contact_email ?? '').toLowerCase().includes(q);
  });

  async function submit() {
    setError(null);
    if (name.trim().length < 1) return setError('Give the group a name.');
    setBusy(true);
    if (editing) {
      const res = await updateGroup(String(id), { name, description, icon });
      setBusy(false);
      if (!res.ok) return setError(res.error.message);
      router.back();
      return;
    }
    const res = await createGroup({ name, description, category, icon, members });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    if (res.data.member_errors.length > 0) {
      Alert.alert(
        'Group created',
        `Some people could not be added:\n${res.data.member_errors.map((e) => `${e.member}: ${e.code}`).join('\n')}`
      );
    }
    router.replace('/groups');
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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen
        scroll
        footer={<Button title={editing ? 'Save changes' : 'Create Group'} icon="check" loading={busy} onPress={submit} />}
      >
        <ScreenHeader title={editing ? 'Edit Group' : 'Create New Group'} onBack={() => router.back()} />

        <View style={{ gap: 18 }}>
          {!editing && (
            <View style={{ gap: 8 }}>
              <Overline>Category</Overline>
              <View style={s.chips}>
                {GROUP_CATEGORIES.map((c) => (
                  <Chip key={c.key} label={`${c.icon} ${c.label}`} selected={category === c.key} onPress={() => pickCategory(c.key)} />
                ))}
              </View>
            </View>
          )}

          <Input label="Group name" icon="groups" placeholder="Group name" value={name} onChangeText={setName} maxLength={60} />
          <Input label="Description" placeholder="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={300} />

          <View style={{ gap: 8 }}>
            <Overline>Icon</Overline>
            <View style={s.chips}>
              {GROUP_ICONS.map((ic) => (
                <Pressable
                  key={ic}
                  onPress={() => { setIcon(ic); setIconTouched(true); }}
                  style={[s.iconChip, icon === ic && s.iconOn]}
                >
                  <Text style={{ fontSize: 22 }}>{ic}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {!editing && (
          <>
            <SectionHeader title="Add members" />
            <Text style={s.mute}>Adding someone does not share anyone's location. People with the app must accept first. Others get an invitation link you share.</Text>

            {contacts.length > 0 && (
              <Card style={{ marginTop: 14, gap: 10 }}>
                <Text style={s.panelTitle}>From your other groups</Text>
                <Input icon="search" placeholder="Search contacts" value={search} onChangeText={setSearch} autoCapitalize="none" />
                {filtered.slice(0, 6).map((c, i) => (
                  <Pressable
                    key={i}
                    style={[s.contactRow, i < Math.min(filtered.length, 6) - 1 && s.line]}
                    onPress={() => addDraft({ contact_name: c.contact_name, contact_email: c.contact_email, contact_phone: c.contact_phone })}
                  >
                    <Avatar name={c.contact_name} px={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.contactName}>{c.contact_name}</Text>
                      <Text style={s.mute}>{c.contact_email ?? c.contact_phone}</Text>
                    </View>
                    <Icon name="add" size={18} color={colors.accent} />
                  </Pressable>
                ))}
                {filtered.length === 0 && <Text style={s.mute}>No matching contacts.</Text>}
              </Card>
            )}

            <Card style={{ marginTop: 14, gap: 12 }}>
              <Text style={s.panelTitle}>Add a new person</Text>
              <Input placeholder="Name" value={mName} onChangeText={setMName} />
              <Input placeholder="Email" value={mEmail} onChangeText={setMEmail} autoCapitalize="none" keyboardType="email-address" />
              <Input placeholder="Phone (optional, e.g. +919876543210)" value={mPhone} onChangeText={setMPhone} keyboardType="phone-pad" />
              <Button title="Add to list" icon="personAdd" variant="secondary" onPress={addManual} />
            </Card>

            {members.length > 0 && (
              <>
                <SectionHeader title={`Members to add (${members.length})`} />
                <Card style={{ paddingVertical: 4 }}>
                  {members.map((m, i) => (
                    <View key={memberKey(m)} style={[s.contactRow, i < members.length - 1 && s.line]}>
                      <Avatar name={m.contact_name} px={34} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.contactName}>{m.contact_name}</Text>
                        <Text style={s.mute}>{m.contact_email ?? m.contact_phone}</Text>
                      </View>
                      <Button title="Remove" small variant="secondary" full={false} onPress={() => setMembers((l) => l.filter((x) => memberKey(x) !== memberKey(m)))} />
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        {editing && (
          <View style={{ marginTop: 20 }}>
            <Button
              title="Manage members"
              icon="groups"
              variant="secondary"
              onPress={() => router.replace({ pathname: '/group-members', params: { id: String(id) } })}
            />
          </View>
        )}

        {error && (
          <View style={s.error}>
            <Icon name="warning" size={16} color={colors.emergency} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChip: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: colors.routeSoft, borderColor: colors.route },
  panelTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  contactName: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16 },
  errorText: { flex: 1, color: '#FFD2C7', fontSize: 13, lineHeight: 18 },
});
