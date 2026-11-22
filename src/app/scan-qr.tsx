import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, StyleSheet, Text, useWindowDimensions, Vibration, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Icon, IconButton, IconTile, Screen, ScreenHeader } from '../components/ui';
import { colors, radius, type } from '../lib/theme';
import { type CameraModule, loadCamera } from '../lib/optionalModules';
import { parseQrPayload } from '../services/connectionsService';

const Camera = loadCamera(); // null when expo-camera is not installed

const CORNER = 28;

function Scanner({ camera }: { camera: CameraModule }) {
  const { CameraView, useCameraPermissions } = camera;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handled = useRef(false);
  const lastBad = useRef(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const frame = Math.min(width * 0.72, 300);

  // allow scanning again whenever this screen comes back into view
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
      setTorch(false);
    }, [])
  );

  // scan line moving up and down inside the frame
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  function onScanned({ data }: { data: string }) {
    if (handled.current) return;
    const token = parseQrPayload(data);
    if (!token) {
      // some other QR code: say so, but keep scanning
      if (Date.now() - lastBad.current > 2500) {
        lastBad.current = Date.now();
        setMessage('That is not an Arrive Notify QR code.');
        setTimeout(() => setMessage(null), 2500);
      }
      return;
    }
    handled.current = true;
    Vibration.vibrate(40);
    router.replace(`/c/${token}`);
  }

  if (!permission) {
    return (
      <Screen>
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <Screen>
        <ScreenHeader title="Scan QR Code" onBack={() => router.back()} />
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
          <IconTile icon="camera" tone="blue" px={64} />
          <Text style={[type.h2, { textAlign: 'center' }]}>{blocked ? 'Camera access is off' : 'Allow camera access'}</Text>
          <Text style={s.mute}>
            {blocked
              ? 'Turn on the camera for Arrive Notify in your phone settings to scan QR codes.'
              : 'Arrive Notify uses the camera only to scan a friend’s QR code. Nothing is recorded or saved.'}
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
            {blocked ? (
              <Button title="Open phone settings" icon="settings" onPress={() => Linking.openSettings()} />
            ) : (
              <Button title="Allow camera" icon="camera" onPress={requestPermission} />
            )}
          </View>
        </Card>
      </Screen>
    );
  }

  const dim = 'rgba(8,13,32,0.72)';
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />

      {/* dimmed surround with a clear square window in the middle */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, backgroundColor: dim }} />
        <View style={{ flexDirection: 'row', height: frame }}>
          <View style={{ flex: 1, backgroundColor: dim }} />
          <View style={{ width: frame, height: frame }}>
            <View style={[s.corner, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radius.md }]} />
            <View style={[s.corner, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radius.md }]} />
            <View style={[s.corner, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radius.md }]} />
            <View style={[s.corner, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radius.md }]} />
            <Animated.View
              style={[s.line, { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [10, frame - 14] }) }] }]}
            />
          </View>
          <View style={{ flex: 1, backgroundColor: dim }} />
        </View>
        <View style={{ flex: 1, backgroundColor: dim }} />
      </View>

      <View style={[s.top, { top: insets.top + 8 }]}>
        <IconButton icon="back" label="Back" onPress={() => router.back()} />
        <Text style={s.title}>Scan QR Code</Text>
        <IconButton icon={torch ? 'flash' : 'flashOff'} label={torch ? 'Turn torch off' : 'Turn torch on'} onPress={() => setTorch((t) => !t)} />
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {message ? (
          <View style={s.msg}>
            <Icon name="warning" size={16} color={colors.emergency} />
            <Text style={s.msgText}>{message}</Text>
          </View>
        ) : (
          <Text style={s.hint}>Point your camera at a friend’s Arrive Notify QR code.</Text>
        )}
        <Button title="Show my QR code" icon="qr" variant="secondary" onPress={() => router.replace('/my-qr')} />
      </View>
    </View>
  );
}

export default function ScanQr() {
  const router = useRouter();
  if (Camera) return <Scanner camera={Camera} />;
  return (
    <Screen>
      <ScreenHeader title="Scan QR Code" onBack={() => router.back()} />
      <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
        <IconTile icon="camera" tone="amber" px={64} />
        <Text style={[type.h2, { textAlign: 'center' }]}>Camera package not installed</Text>
        <Text style={s.mute}>Scanning needs the expo-camera package. Stop the app, then in your project folder run:</Text>
        <View style={s.code}>
          <Text style={s.codeText}>npm install</Text>
        </View>
        <Text style={s.mute}>and start again with:</Text>
        <View style={s.code}>
          <Text style={s.codeText}>npx expo start -c</Text>
        </View>
        <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
          <Button title="Show my QR code instead" icon="qr" variant="secondary" onPress={() => router.replace('/my-qr')} />
        </View>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  code: { alignSelf: 'stretch', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  codeText: { color: colors.accent, fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  mute: { color: colors.mute, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.accent },
  line: { position: 'absolute', left: 10, right: 10, height: 3, borderRadius: 2, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 16, gap: 14, backgroundColor: 'rgba(8,13,32,0.9)', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  hint: { color: colors.ink, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  msg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  msgText: { color: '#FFD2C7', fontSize: 14, fontWeight: '700' },
});
