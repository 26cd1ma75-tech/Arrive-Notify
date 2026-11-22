import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import { Badge, Button, Card, Overline, PulseDot, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { fmtTime } from '../lib/format';
import { darkMapStyle } from '../lib/mapStyle';
import { colors, radius, type } from '../lib/theme';
import { EMERGENCY_NUMBER, SOS_STALE_AFTER_MS, googleMapsUrl } from '../lib/sos';
import { acknowledgeSos, getSosDetails } from '../services/sosService';
import { subscribeToSosAlert } from '../services/realtimeService';
import type { SosAlert, SosRecipient } from '../lib/types';

function ago(iso: string | null, now: number) {
  if (!iso) return 'unknown';
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec} s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  return `${Math.floor(sec / 3600)} h ago`;
}

export default function SosView() {
  const router = useRouter();
  const { height: winH } = useWindowDimensions();
  const mapHeight = Math.round(Math.max(320, Math.min(460, winH * 0.45)));
  const { id } = useLocalSearchParams<{ id: string }>();
  const [alertRow, setAlertRow] = useState<SosAlert | null>(null);
  const [mine, setMine] = useState<SosRecipient | null>(null);
  const [isSender, setIsSender] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState('CONNECTING');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);

  const refresh = useCallback(async () => {
    const res = await getSosDetails(String(id));
    if (res.ok) {
      setAlertRow(res.data.alert);
      setIsSender(res.data.is_sender);
      setMine(res.data.recipients[0] ?? null);
      setError(null);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // the latest location arrives live (same security rule as the list: only chosen contacts)
  useEffect(
    () => subscribeToSosAlert(String(id), (row) => setAlertRow((prev) => (prev ? { ...prev, ...row, maps_url: undefined } : prev)), setChannel),
    [id]
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (channel === 'SUBSCRIBED') return;
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [channel, refresh]);

  const lat = alertRow?.latitude ?? null;
  const lng = alertRow?.longitude ?? null;
  useEffect(() => {
    if (lat != null && lng != null) {
      mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
    }
  }, [lat, lng]);

  async function respond(response: 'seen' | 'on_my_way') {
    setBusy(response);
    const res = await acknowledgeSos(String(id), response);
    setBusy(null);
    if (!res.ok) return Alert.alert('Could not send', res.error.message);
    refresh();
  }

  if (loading) {
    return (
      <Screen>
        <View style={s.center}>
          <PulseDot color={colors.emergency} />
        </View>
      </Screen>
    );
  }
  if (!alertRow) {
    return (
      <Screen>
        <View style={s.center}>
          <Text style={type.h2}>Cannot show this emergency</Text>
          <Text style={[s.sub, { textAlign: 'center' }]}>{error ?? 'It was not found.'}</Text>
          <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
            <Button title="Back" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  const active = alertRow.status === 'active' && new Date(alertRow.expires_at).getTime() > now;
  const hasLoc = lat != null && lng != null;
  const ageMs = alertRow.location_updated_at ? now - new Date(alertRow.location_updated_at).getTime() : null;
  const stale = active && hasLoc && (ageMs == null || ageMs > SOS_STALE_AFTER_MS);
  const mapsUrl = hasLoc ? googleMapsUrl(lat as number, lng as number) : null;

  return (
    <Screen scroll>
      <ScreenHeader title="Emergency" onBack={() => router.back()} />

      <Card tone={active ? 'emergency' : 'flat'} style={{ gap: 8 }}>
        <View style={s.row}>
          {active && <PulseDot color={colors.emergency} />}
          <Text style={[s.barTitle, { color: active ? colors.emergency : colors.mute }]}>
            {active ? 'EMERGENCY' : alertRow.status === 'resolved' ? 'RESOLVED' : 'ENDED'}
          </Text>
        </View>
        <Text style={s.barSub}>
          {active
            ? `${alertRow.sender_name} needs help. Alert sent at ${fmtTime(alertRow.created_at)}.`
            : alertRow.status === 'resolved'
              ? `${alertRow.sender_name} marked this emergency as resolved. Their location is no longer shared.`
              : 'This alert expired. Their location is no longer shared.'}
        </Text>
      </Card>

      {!!alertRow.message && (
        <Card tone="flat" style={{ marginTop: 12, gap: 6 }}>
          <Overline>Message from {alertRow.sender_name}</Overline>
          <Text style={s.msg}>{alertRow.message}</Text>
        </Card>
      )}

      {active && (
        <>
          <SectionHeader title="Location" />
          {hasLoc ? (
            <>
              <View style={[s.mapBox, { height: mapHeight }]}>
                <MapView
                  ref={mapRef}
                  style={StyleSheet.absoluteFill}
                  customMapStyle={darkMapStyle}
                  userInterfaceStyle="dark"
                  initialRegion={{ latitude: lat as number, longitude: lng as number, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                >
                  <Marker coordinate={{ latitude: lat as number, longitude: lng as number }} title={alertRow.sender_name} pinColor={colors.emergency} />
                </MapView>
              </View>
              <View style={[s.row, { marginTop: 10, flexWrap: 'wrap' }]}>
                <Badge label={stale ? 'Outdated' : 'Live'} tone={stale ? 'amber' : 'green'} dot caps={false} />
                <Text style={s.sub}>
                  Last update {ago(alertRow.location_updated_at, now)}
                  {alertRow.accuracy != null ? ` · accuracy about ${Math.round(alertRow.accuracy)} m` : ''}
                </Text>
              </View>
              {stale && <Text style={s.warn}>This location is outdated. {alertRow.sender_name} may have no signal or closed the app.</Text>}
              <View style={{ marginTop: 12 }}>
                <Button title="Open in Google Maps" icon="map" variant="secondary" onPress={() => Linking.openURL(mapsUrl as string)} />
              </View>
            </>
          ) : (
            <Card tone="flat">
              <Text style={s.warn}>{alertRow.sender_name}'s location is not available. Try to reach them by phone.</Text>
            </Card>
          )}

          {!isSender && (
            <>
              <SectionHeader title={`Let ${alertRow.sender_name} know`} />
              <Text style={[s.sub, { marginBottom: 10 }]}>
                {mine?.response === 'on_my_way' ? 'You said you are on your way.' : mine?.response === 'seen' ? 'You said you have seen this.' : 'They can see when you answer.'}
              </Text>
              <View style={s.row}>
                <Button title="I have seen this" icon="eye" variant="secondary" style={{ flex: 1 }} loading={busy === 'seen'} disabled={busy !== null} onPress={() => respond('seen')} />
                <Button title="I am on my way" icon="car" variant="success" style={{ flex: 1 }} loading={busy === 'on_my_way'} disabled={busy !== null} onPress={() => respond('on_my_way')} />
              </View>
            </>
          )}
          <View style={{ marginTop: 16 }}>
            <Button title={`Call ${EMERGENCY_NUMBER} (emergency services)`} icon="call" variant="danger" onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)} />
          </View>
        </>
      )}

      <Text style={s.note}>
        {channel === 'SUBSCRIBED' ? '● Live updates on. ' : '○ Reconnecting. '}You can see this because {alertRow.sender_name} chose you as an emergency contact.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sub: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 18, marginTop: 8 },
  note: { color: colors.dim, fontSize: 11, lineHeight: 16, marginTop: 22 },
  barTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  barSub: { color: '#FFD2C7', fontSize: 14, lineHeight: 20 },
  msg: { color: colors.ink, fontSize: 16, lineHeight: 22 },
  mapBox: { height: 260, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
});
