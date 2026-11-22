import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Button, Icon, Input, Screen, ScreenHeader } from '../components/ui';
import { colors } from '../lib/theme';
import { acceptGroupInvitation } from '../services/groupsService';

export default function JoinGroup() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) setCode(String(token));
  }, [token]);

  async function join() {
    setError(null);
    setBusy(true);
    const res = await acceptGroupInvitation(code);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    Alert.alert('You joined the group', `You are now in "${res.data.group.name}".`);
    router.replace('/groups');
  }

  const tooShort = code.trim().length < 20;
  return (
    <Screen scroll footer={<Button title="Join group" icon="groupAdd" loading={busy} disabled={tooShort} onPress={join} />}>
      <ScreenHeader
        title="Join a group"
        subtitle="Paste the invitation code you received. Joining only lets the group owner choose to notify you about their journeys. It never shares your location."
        onBack={() => router.back()}
      />
      <Input
        label="Invitation code"
        icon="link"
        placeholder="Paste your code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error && (
        <View style={s.error}>
          <Icon name="warning" size={16} color={colors.emergency} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 },
  errorText: { flex: 1, color: '#FFD2C7', fontSize: 13, lineHeight: 18 },
});
