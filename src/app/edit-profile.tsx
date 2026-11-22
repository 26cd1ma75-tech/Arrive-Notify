import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Button, Input, Screen, ScreenHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function EditProfile() {
  const { session } = useAuth();
  const router = useRouter();
  const current: string = session?.user.user_metadata?.name ?? '';
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== current;

  async function save() {
    if (!changed || !session) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { name: trimmed } });
    if (error) {
      setSaving(false);
      Alert.alert('Could not save', error.message);
      return;
    }
    // Keep the public profile row (used when people find you) in step. Best effort only.
    await supabase.from('profiles').update({ name: trimmed }).eq('id', session.user.id);
    setSaving(false);
    router.back();
  }

  return (
    <Screen scroll footer={<Button title="Save changes" icon="check" disabled={!changed} loading={saving} onPress={save} />}>
      <ScreenHeader title="Edit Profile" onBack={() => router.back()} />
      <View style={s.avatar}>
        <Avatar name={trimmed || current} px={96} />
      </View>
      <View style={{ gap: 16 }}>
        <Input label="Name" icon="profile" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" maxLength={60} />
        <View style={{ gap: 6 }}>
          <Input label="Email" icon="mail" value={session?.user.email ?? ''} editable={false} style={{ color: colors.mute }} />
          <Text style={s.hint}>Your email is your sign-in and cannot be changed here.</Text>
        </View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  avatar: { alignItems: 'center', marginBottom: 28 },
  hint: { color: colors.dim, fontSize: 12 },
});
