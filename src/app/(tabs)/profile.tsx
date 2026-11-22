import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Badge, Button, Card, ConfirmModal, ListRow, Screen, ScreenHeader, SectionHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, type } from '../../lib/theme';

export default function Profile() {
  const { session } = useAuth();
  const router = useRouter();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const name: string = session?.user.user_metadata?.name ?? 'Your name';
  const email = session?.user.email ?? '';

  return (
    <Screen scroll tab>
      <ScreenHeader title="Profile" />

      <Card style={s.hero}>
        <Avatar name={name} px={84} />
        <Text style={[type.h2, { marginTop: 14 }]} numberOfLines={1}>{name}</Text>
        <Text style={s.mute} numberOfLines={1}>{email}</Text>
        <View style={{ marginTop: 10 }}>
          <Badge label="Signed in" tone="green" dot />
        </View>
        <Button title="Edit Profile" icon="edit" variant="secondary" small full={false} style={{ marginTop: 16 }} onPress={() => router.push('/edit-profile')} />
      </Card>

      <SectionHeader title="Safety & privacy" />
      <Card style={s.list}>
        <ListRow icon="call" tone="orange" title="Emergency Contacts" subtitle="Who is alerted when you press SOS" onPress={() => router.push('/emergency-contacts')} />
        <ListRow icon="privacy" title="Privacy Settings" subtitle="Location sharing and permissions" onPress={() => router.push('/privacy')} />
        <ListRow icon="bell" title="Notification Settings" subtitle="Alerts and defaults" onPress={() => router.push('/notification-settings')} last />
      </Card>

      <SectionHeader title="Your Arrive Notify" />
      <Card style={s.list}>
        <ListRow icon="pin" title="Saved places" subtitle="Home, Office, College and more" onPress={() => router.push('/places')} />
        <ListRow icon="contacts" title="Your people" subtitle="Everyone you can notify" onPress={() => router.push('/contacts')} />
        <ListRow icon="radar" title="Shared with me" subtitle="Journeys and alerts from others" onPress={() => router.push('/shared')} last />
      </Card>

      <SectionHeader title="App" />
      <Card style={s.list}>
        <ListRow icon="info" title="About Arrive Notify" onPress={() => router.push('/about')} last />
      </Card>

      <View style={{ height: 20 }} />
      <Button title="Log out" icon="logout" variant="secondary" onPress={() => setConfirmLogout(true)} />

      <ConfirmModal
        visible={confirmLogout}
        tone="danger"
        title="Log out?"
        message="You will need to sign in again to start journeys or see alerts."
        confirmLabel="Log out"
        onConfirm={() => {
          setConfirmLogout(false);
          supabase.auth.signOut();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: 24 },
  mute: { color: colors.mute, fontSize: 14, marginTop: 2 },
  list: { paddingVertical: 4, paddingHorizontal: 14 },
});
