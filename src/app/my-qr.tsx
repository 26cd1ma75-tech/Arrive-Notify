import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Platform, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import { Button, Card, ConfirmModal, ErrorNote, Icon, PersonAvatar, Screen, ScreenHeader } from '../components/ui';
import QrCode from '../components/ui/QrCode';
import { useAuth } from '../lib/auth';
import { loadSharing } from '../lib/optionalModules';
import { encodeQr } from '../lib/qr';
import { qrToPng } from '../lib/png';
import { colors, radius, type } from '../lib/theme';
import { buildQrPayload, getMyQr, type MyQr, regenerateMyQr } from '../services/connectionsService';
import { isMissingRpc } from '../services/privacyService';

const FILE_NAME = 'arrive-notify-qr.png';

export default function MyQrCode() {
  const router = useRouter();
  const { session } = useAuth();
  const { width } = useWindowDimensions();
  const name: string = session?.user.user_metadata?.name ?? 'Your name';
  const avatar: string | null = session?.user.user_metadata?.avatar_url ?? null;

  const [qr, setQr] = useState<MyQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'share' | 'save' | 'refresh'>(null);
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  // gentle entrance for each new code
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!qr) return;
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [qr?.token, appear]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const res = await getMyQr();
    if (res.ok) {
      setQr(res.data);
      setError(null);
    } else {
      setError(isMissingRpc(res.error) ? 'SETUP' : res.error.message);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const payload = qr ? buildQrPayload(qr.token) : null;
  const qrSize = Math.min(width - 40 - 36 - 36, 320); // screen padding, card padding, plate padding

  // the QR as a PNG file in the cache folder
  function makePng(): Uint8Array {
    return qrToPng(encodeQr(payload as string), 14, 4);
  }

  async function share() {
    if (!payload) return;
    setBusy('share');
    try {
      const Sharing = loadSharing();
      const sheet = Sharing ? await Sharing.isAvailableAsync() : false;
      if (sheet || Platform.OS === 'ios') {
        const file = new File(Paths.cache, FILE_NAME);
        if (file.exists) file.delete();
        file.create();
        await file.write(makePng());
        if (Sharing && sheet) {
          await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: 'Share my Arrive Notify QR code', UTI: 'public.png' });
        } else {
          await Share.share({ url: file.uri }); // iPhone's own share sheet can send the image file
        }
      } else {
        await Share.share({ message: `Add me on Arrive Notify: ${payload}` });
      }
    } catch {
      Alert.alert('Could not share', 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  // lets the user pick a folder on the phone and writes the image there
  async function save() {
    if (!payload) return;
    setBusy('save');
    try {
      const dir = await Directory.pickDirectoryAsync();
      const file = dir.createFile(FILE_NAME, 'image/png');
      await file.write(makePng());
      Alert.alert('Saved', 'Your QR code image was saved in the folder you chose.');
    } catch {
      // the person closed the folder picker: nothing to report
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy('refresh');
    const res = await regenerateMyQr();
    setBusy(null);
    setConfirmRefresh(false);
    if (!res.ok) return Alert.alert('Could not refresh', res.error.message);
    setQr(res.data);
  }

  const until = qr ? new Date(qr.expires_at).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';

  return (
    <Screen scroll>
      <ScreenHeader title="My QR Code" subtitle="Let a friend scan this to connect." onBack={() => router.back()} />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      ) : error === 'SETUP' ? (
        <Card tone="flat" style={s.note}>
          <Icon name="info" size={18} color={colors.warning} />
          <Text style={[s.noteText, { color: colors.warning }]}>QR codes need a one-time database update. Run people-qr-backend.sql in your Supabase SQL Editor, then come back.</Text>
        </Card>
      ) : error || !payload ? (
        <ErrorNote message={error ?? 'Could not create your QR code.'} onRetry={() => { setLoading(true); load(); }} />
      ) : (
        <>
          <Card style={s.card}>
            <View style={s.who}>
              <PersonAvatar name={name} url={avatar} px={52} />
              <View style={{ flex: 1 }}>
                <Text style={type.h2} numberOfLines={1}>{name}</Text>
                <Text style={s.mute}>Arrive Notify</Text>
              </View>
            </View>
            <Animated.View
              style={[s.plate, { opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}
            >
              <QrCode value={payload} maxSize={qrSize} radius={radius.md} />
            </Animated.View>
            <Text style={s.caption}>Scan with Arrive Notify: Add People, then Scan QR Code</Text>
            <Text style={s.mute}>Valid until {until}</Text>
          </Card>

          <View style={{ gap: 10, marginTop: 18 }}>
            <Button title="Share QR code" icon="share" loading={busy === 'share'} disabled={busy !== null} onPress={share} />
            <View style={s.row}>
              <Button title="Save image" icon="download" variant="secondary" style={{ flex: 1 }} loading={busy === 'save'} disabled={busy !== null} onPress={save} />
              <Button title="New code" icon="refresh" variant="secondary" style={{ flex: 1 }} disabled={busy !== null} onPress={() => setConfirmRefresh(true)} />
            </View>
          </View>

          <Card tone="flat" style={[s.note, { marginTop: 18 }]}>
            <Icon name="lock" size={18} color={colors.success} />
            <Text style={s.noteText}>
              Your code holds a random secret only. It never contains your name, email or location. If it is shared by mistake, tap New code and the old one stops working.
            </Text>
          </Card>
        </>
      )}

      <ConfirmModal
        visible={confirmRefresh}
        title="Create a new QR code?"
        message="Your current code stops working right away. People who already connected stay connected."
        confirmLabel="Create new code"
        busy={busy === 'refresh'}
        onConfirm={refresh}
        onCancel={() => setConfirmRefresh(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { alignItems: 'center', gap: 14, paddingVertical: 20 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
  plate: { padding: 18, borderRadius: radius.xl, backgroundColor: '#FFFFFF', shadowColor: colors.route, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  caption: { color: colors.ink, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  mute: { color: colors.mute, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteText: { flex: 1, color: colors.mute, fontSize: 13, lineHeight: 19 },
});
