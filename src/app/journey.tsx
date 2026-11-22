import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { Avatar, Badge, Button, Card, ConfirmModal, Icon, IconButton, Overline, ProgressBar, PulseDot, Screen } from '../components/ui';
import { fmtDuration, fmtTime } from '../lib/format';
import { darkMapStyle } from '../lib/mapStyle';
import { colors, radius, type } from '../lib/theme';
import { distanceM, fmtDist, LatLng } from '../lib/geo';
import {
  ETA_FORCE_REFRESH_MS, ETA_MIN_MOVE_M, ETA_REFRESH_MS, MAX_GOOD_ACCURACY_M, TRACKING_MODES, TrackingMode,
} from '../lib/trackingConfig';
import { cancelJourney, getJourney } from '../services/journeyService';
import { clearLocationQueue, LocationUpdateData, sendJourneyLocation } from '../services/locationService';
import { processArrival } from '../services/arrivalService';
import { decodePolyline, getRoute, routingAttribution } from '../services/routingService';
import { getJourneyRecipients, setJourneySharing, updateJourneyRoute } from '../services/trackingService';
import type { ServiceResult } from '../services/result';
import type { Journey, JourneyRecipient, RouteInfo } from '../lib/types';

export default function LiveJourney() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const lastSent = useRef(0);
  const arrivedAlerted = useRef(false);
  const routingBusy = useRef(false);
  const lastRouteAt = useRef(0);
  const lastRoutePos = useRef<LatLng | null>(null);

  const [journey, setJourney] = useState<Journey | null>(null);
  const [recipients, setRecipients] = useState<JourneyRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [offline, setOffline] = useState(false);
  const [mode, setMode] = useState<TrackingMode>('normal');
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [etaError, setEtaError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'end' | 'share' | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [expanded, setExpanded] = useState(false); // bottom panel: compact by default so the map stays large
  const [sheetH, setSheetH] = useState(240); // measured height of the bottom panel
  const framed = useRef(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const insets = useSafeAreaInsets();

  // Keeps "journey duration" ticking
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // 1) Load the journey and its recipients
  const loadJourney = useCallback(async () => {
    const [j, r] = await Promise.all([getJourney(String(id)), getJourneyRecipients(String(id))]);
    if (j.ok) setJourney(j.data);
    else setLoadError(j.error.message);
    if (r.ok) setRecipients(r.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadJourney();
  }, [loadJourney]);

  const isActive = journey?.status === 'active';
  const journeyId = journey?.id;
  const storedPoints = useMemo(
    () => (journey?.route_polyline ? decodePolyline(journey.route_polyline) : []),
    [journey?.route_polyline]
  );

  useEffect(() => {
    if (framed.current || !me || !journey || !mapRef.current) return;
    framed.current = true;
    mapRef.current.fitToCoordinates(
      [me, { latitude: journey.destination_latitude, longitude: journey.destination_longitude }],
      { edgePadding: { top: 130, right: 60, bottom: sheetH + 50, left: 60 }, animated: true }
    );
  }, [me, journey, sheetH]);

  function handleResult(res: ServiceResult<LocationUpdateData> | null) {
    if (!res) return;
    if (res.ok) {
      setOffline(false);
      if (res.data.status === 'arrived') {
        setJourney((prev) => (prev ? { ...prev, ...res.data.journey } : prev));
        arrivedAlerted.current = true; // the arrival confirmation screen takes over
      }
      return;
    }
    if (res.error.code === 'NETWORK_ERROR') setOffline(true);
    else if (res.error.code === 'JOURNEY_NOT_ACTIVE') loadJourney();
  }

  // 2) Foreground GPS, only while the journey is active
  useEffect(() => {
    if (!isActive || !journeyId) return;
    const cfg = TRACKING_MODES[mode];
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setGpsDenied(true);
        return;
      }
      setGpsDenied(false);
      sub = await Location.watchPositionAsync(
        { accuracy: cfg.accuracy, timeInterval: cfg.timeInterval, distanceInterval: cfg.distanceInterval },
        (pos) => {
          setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setAccuracy(pos.coords.accuracy ?? null);
          const now = Date.now();
          if (now - lastSent.current < cfg.uploadMinMs) return;
          lastSent.current = now;
          sendJourneyLocation(journeyId, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            recordedAt: pos.timestamp,
          }).then(handleResult);
        }
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [isActive, journeyId, mode]);

  // 3) Route-based ETA from the routing provider. Refreshed when the position changes
  //    enough, never faster than once a minute. Weak GPS readings are not used.
  useEffect(() => {
    if (!isActive || !me || !journey || routingBusy.current) return;
    if (accuracy != null && accuracy > MAX_GOOD_ACCURACY_M) return;
    const now = Date.now();
    const age = now - lastRouteAt.current;
    const moved = lastRoutePos.current ? distanceM(lastRoutePos.current, me) : Infinity;
    const due = lastRouteAt.current === 0 || (age >= ETA_REFRESH_MS && moved >= ETA_MIN_MOVE_M) || age >= ETA_FORCE_REFRESH_MS;
    if (!due) return;

    routingBusy.current = true;
    lastRouteAt.current = now;
    lastRoutePos.current = me;
    const dest = { latitude: journey.destination_latitude, longitude: journey.destination_longitude };
    (async () => {
      const res = await getRoute(me, dest);
      if (res.ok) {
        setRoute(res.data);
        setEtaError(null);
        const saved = await updateJourneyRoute(journey.id, {
          eta_seconds: Math.round(res.data.duration_s),
          route_distance_m: Math.round(res.data.distance_m),
          polyline: res.data.polyline,
          provider: res.data.provider,
        });
        if (saved.ok) {
          setJourney((j) =>
            j ? { ...j, eta_seconds: saved.data.eta_seconds, estimated_arrival_at: saved.data.estimated_arrival_at, route_distance_m: saved.data.route_distance_m, eta_updated_at: new Date().toISOString() } : j
          );
        }
      } else {
        setEtaError(res.error.message);
      }
      routingBusy.current = false;
    })();
  }, [me]);

  const viewers = recipients.filter((r) => r.can_track);
  const sharing = !!journey?.share_live_location;

  async function toggleSharing() {
    if (!journey) return;
    setBusy('share');
    const res = await setJourneySharing(journey.id, !sharing);
    setBusy(null);
    if (!res.ok) return Alert.alert('Could not change sharing', res.error.message);
    setJourney({ ...journey, share_live_location: res.data.sharing });
  }

  async function endJourney() {
    if (!journey) return;
    setBusy('end');
    const res = await processArrival(journey.id);
    setBusy(null);
    if (!res.ok) {
      if (res.error.code === 'NOT_AT_DESTINATION') {
        const d = res.error.details?.distance_m;
        Alert.alert(
          'Not at the destination yet',
          `You are about ${d != null ? fmtDist(d) : 'some distance'} from ${journey.destination_name}. If you changed your plans, use Cancel Journey instead.`
        );
      } else {
        Alert.alert('Could not end the journey', res.error.message);
      }
      return;
    }
    arrivedAlerted.current = true;
    setJourney((prev) => (prev ? { ...prev, ...res.data.journey } : prev));
  }

  async function doCancel() {
    if (!journey) return;
    setBusy('cancel');
    const res = await cancelJourney(journey.id);
    setBusy(null);
    setShowCancel(false);
    if (!res.ok) return Alert.alert('Could not cancel', res.error.message);
    clearLocationQueue();
    router.replace('/');
  }

  if (loading) {
    return (
      <Screen>
        <View style={s.center}>
          <PulseDot color={colors.accent} />
          <Text style={s.sub}>Opening journey…</Text>
        </View>
      </Screen>
    );
  }
  if (loadError || !journey) {
    return (
      <Screen>
        <View style={s.center}>
          <Text style={type.h2}>Could not open this journey</Text>
          <Text style={[s.sub, { textAlign: 'center' }]}>{loadError ?? 'It was not found.'}</Text>
          <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
            <Button title="Back to Home" onPress={() => router.replace('/')} />
          </View>
        </View>
      </Screen>
    );
  }

  const dest: LatLng = { latitude: journey.destination_latitude, longitude: journey.destination_longitude };
  const start: LatLng | null =
    journey.start_latitude != null && journey.start_longitude != null
      ? { latitude: journey.start_latitude, longitude: journey.start_longitude }
      : null;
  const straight = me ? distanceM(me, dest) : null;
  const routeMeters = route ? route.distance_m : journey.route_distance_m ?? null;
  const linePoints = route?.points ?? storedPoints;
  const etaMin = journey.eta_seconds != null ? Math.max(1, Math.round(journey.eta_seconds / 60)) : null;

  // Finished journeys: arrival / cancellation confirmation (reference slide "You Have Arrived!")
  if (!isActive) {
    const arrived = journey.status === 'arrived';
    const tone = arrived ? colors.success : colors.emergency;
    return (
      <Screen
        scroll
        footer={<Button title="Done & Return Home" onPress={() => router.replace('/')} />}
        contentStyle={{ alignItems: 'center', paddingTop: 64 }}
      >
        <View style={[s.ring, { borderColor: tone, backgroundColor: arrived ? colors.successSoft : colors.emergencySoft }]}>
          <Icon name={arrived ? 'check' : 'close'} size={56} color={tone} />
        </View>
        <Text style={[type.display, { marginTop: 24, textAlign: 'center' }]}>{arrived ? 'You Have Arrived!' : 'Journey Cancelled'}</Text>
        <Text style={[s.sub, { marginTop: 6, textAlign: 'center', fontSize: 15 }]}>
          {journey.destination_name}
          {arrived && journey.arrived_at ? `  •  ${fmtTime(journey.arrived_at)}` : ''}
        </Text>
        <View style={{ marginTop: 16 }}>
          <Badge label={arrived ? 'Location sharing terminated' : 'Location sharing stopped'} tone={arrived ? 'green' : 'orange'} icon="lock" caps={false} />
        </View>

        <View style={{ alignSelf: 'stretch', marginTop: 32 }}>
          <Overline>{arrived ? 'Arrival notifications' : 'Who was notified'}</Overline>
          <Card style={{ marginTop: 10, paddingVertical: 6 }}>
            {recipients.length === 0 ? (
              <Text style={[s.sub, { paddingVertical: 12 }]}>Nobody was chosen for this journey.</Text>
            ) : (
              recipients.map((r, i) => (
                <View key={`${r.recipient_name}-${i}`} style={[s.receipt, i < recipients.length - 1 && s.receiptLine]}>
                  <Avatar name={r.recipient_name} px={32} tone={arrived ? 'green' : 'blue'} />
                  <Text style={s.recName} numberOfLines={1}>{r.recipient_name}</Text>
                  <Badge label={r.notification_enabled ? 'Notified' : 'Not notified'} tone={r.notification_enabled ? 'green' : 'neutral'} caps={false} />
                </View>
              ))
            )}
          </Card>
        </View>
      </Screen>
    );
  }

  const elapsed = Math.max(0, (nowMs - new Date(journey.started_at).getTime()) / 1000);
  let progress: number | null = null;
  if (start && me) {
    const total = distanceM(start, dest);
    if (total > 30) progress = Math.max(0, Math.min(1, 1 - distanceM(me, dest) / total));
  }
  const remaining = routeMeters ?? straight;
  const weak = accuracy != null && accuracy > MAX_GOOD_ACCURACY_M;
  const warnings: string[] = [];
  if (journey.estimated_arrival_at == null) {
    warnings.push(etaError ? `ETA unavailable: ${etaError}` : me ? 'Calculating the route and arrival time…' : 'Waiting for your location to calculate the ETA…');
  } else if (etaError) {
    warnings.push(`Could not refresh the ETA: ${etaError}`);
  }
  if (gpsDenied) warnings.push('Location permission is off, so live tracking is unavailable.');
  if (weak) warnings.push(`GPS signal is weak (about ${Math.round(accuracy ?? 0)} m). Arrival and ETA only use reliable readings.`);
  if (offline) warnings.push('No connection. Location updates are queued and sent when you are back online.');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        initialRegion={{ ...dest, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {start && <Marker coordinate={start} title="Start" pinColor={colors.success} />}
        <Marker coordinate={dest} title={journey.destination_name} pinColor={colors.route} />
        <Circle center={dest} radius={journey.arrival_radius} strokeColor="rgba(99,165,255,0.95)" fillColor="rgba(71,120,255,0.20)" strokeWidth={2} />
        {linePoints.length > 1 && <Polyline coordinates={linePoints} strokeColor={colors.accent} strokeWidth={5} />}
      </MapView>

      {/* Floating controls */}
      <View style={[s.top, { top: insets.top + 8 }]}>
        <IconButton icon="back" label="Back to Home" onPress={() => router.replace('/')} />
        <View style={[s.live, !gpsDenied && sharing && { borderColor: '#1E6F5E' }]}>
          <PulseDot color={gpsDenied ? colors.warning : colors.success} active={!gpsDenied} />
          <Text style={[s.liveText, { color: gpsDenied ? colors.warning : colors.success }]}>{gpsDenied ? 'GPS OFF' : 'LIVE TRACKING'}</Text>
        </View>
        <View style={s.topRight}>
          {me && (
            <IconButton
              icon="locate"
              label="Show route"
              onPress={() => mapRef.current?.fitToCoordinates([me, dest], { edgePadding: { top: 140, right: 60, bottom: sheetH + 50, left: 60 }, animated: true })}
            />
          )}
          <Pressable
            style={s.sos}
            accessibilityRole="button"
            accessibilityLabel="Emergency SOS"
            onPress={() => router.push({ pathname: '/sos', params: { journeyId: journey.id } })}
          >
            <Text style={s.sosText}>SOS</Text>
          </Pressable>
        </View>
      </View>

      {/* Journey sheet */}
      <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}>
        <Pressable
          onPress={() => setExpanded((x) => !x)}
          hitSlop={8}
          style={s.handleWrap}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Hide details' : 'Show details'}
        >
          <View style={s.handle} />
          <Text style={s.handleText}>
            {expanded ? 'Hide details' : warnings.length ? `Details · ${warnings.length} ${warnings.length === 1 ? 'notice' : 'notices'}` : 'Details'}
          </Text>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          <View>
            <View style={s.between}>
              <View style={{ flex: 1 }}>
                <Text style={s.dest} numberOfLines={1}>{journey.destination_name}</Text>
              </View>
              <Badge label={sharing ? `Sharing with ${viewers.length}` : 'Not sharing'} tone={sharing ? 'green' : 'neutral'} dot caps={false} />
            </View>
            {expanded && !!journey.destination_address && <Text style={[s.sub, { marginTop: 2 }]} numberOfLines={1}>{journey.destination_address}</Text>}
          </View>

          <View>
            <View style={s.etaRow}>
              <Text style={s.eta}>{journey.estimated_arrival_at ? fmtTime(journey.estimated_arrival_at) : '–'}</Text>
              <Text style={s.away}>{etaMin != null ? `${etaMin} min away` : 'Calculating…'}</Text>
            </View>
            {progress != null && (
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={progress} />
              </View>
            )}
          </View>

          {expanded && (
            <>
          <View style={s.stats}>
            <View style={s.stat}>
              <Overline>Remaining</Overline>
              <Text style={s.statValue}>{remaining != null ? fmtDist(remaining) : '–'}</Text>
              <Text style={s.statNote}>{routeMeters != null ? 'by road' : straight != null ? 'straight line' : ' '}</Text>
            </View>
            <View style={s.stat}>
              <Overline>Duration</Overline>
              <Text style={s.statValue}>{fmtDuration(elapsed)}</Text>
              <Text style={s.statNote}>since {fmtTime(journey.started_at)}</Text>
            </View>
            <View style={s.stat}>
              <Overline>GPS</Overline>
              <Text style={[s.statValue, weak && { color: colors.warning }]}>{accuracy != null ? `±${Math.round(accuracy)} m` : '–'}</Text>
              <Text style={s.statNote}>{weak ? 'weak signal' : accuracy != null ? 'locked' : ' '}</Text>
            </View>
          </View>

          {warnings.map((w) => (
            <Card key={w} tone="flat" style={s.warn}>
              <Icon name="warning" size={16} color={colors.warning} />
              <Text style={s.warnText}>{w}</Text>
            </Card>
          ))}

          <View style={{ gap: 8 }}>
            <Overline>Selected recipients</Overline>
            {recipients.length === 0 ? (
              <Text style={s.sub}>Nobody was chosen for this journey.</Text>
            ) : (
              <Card style={{ paddingVertical: 4 }}>
                {recipients.map((r, i) => (
                  <View key={`${r.recipient_name}-${i}`} style={[s.receipt, i < recipients.length - 1 && s.receiptLine]}>
                    <Avatar name={r.recipient_name} px={32} />
                    <Text style={s.recName} numberOfLines={1}>{r.recipient_name}</Text>
                    <Badge
                      label={r.can_track ? (sharing ? 'Watching live' : 'Sharing paused') : 'Notified'}
                      tone={r.can_track ? (sharing ? 'green' : 'amber') : 'blue'}
                      caps={false}
                    />
                  </View>
                ))}
              </Card>
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Overline>Update frequency</Overline>
            <View style={s.chips}>
              {(Object.keys(TRACKING_MODES) as TrackingMode[]).map((m) => (
                <Pressable key={m} onPress={() => setMode(m)} style={[s.chip, mode === m && s.chipOn]}>
                  <Text style={[s.chipText, mode === m && { color: colors.onPrimary }]}>{TRACKING_MODES[m].label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {viewers.length > 0 && (
            <Button
              title={sharing ? 'Stop sharing location' : 'Resume sharing location'}
              icon={sharing ? 'eyeOff' : 'eye'}
              variant="secondary"
              loading={busy === 'share'}
              disabled={busy !== null}
              onPress={toggleSharing}
            />
          )}

            </>
          )}
          <View style={s.btnRow}>
            <Button title="End Journey" icon="flag" style={{ flex: 1 }} loading={busy === 'end'} disabled={busy !== null} onPress={endJourney} />
            <Button title="Cancel Journey" icon="close" variant="danger" style={{ flex: 1 }} disabled={busy !== null} onPress={() => setShowCancel(true)} />
          </View>

          {expanded && (
          <Text style={s.note}>
            {me ? `Your location: ${me.latitude.toFixed(5)}, ${me.longitude.toFixed(5)}. ` : ''}
            Tracking works while this screen is open. Arrival is confirmed by the server. {routingAttribution}.
          </Text>
          )}
        </ScrollView>
      </View>

      <ConfirmModal
        visible={showCancel}
        tone="danger"
        title="Cancel this journey?"
        message={`Stop the journey to ${journey.destination_name}? Location sharing stops right away.`}
        confirmLabel="Cancel journey"
        cancelLabel="Keep going"
        busy={busy === 'cancel'}
        onConfirm={doCancel}
        onCancel={() => setShowCancel(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  sub: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(8,13,32,0.9)', borderWidth: 1, borderColor: colors.line },
  liveText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  sos: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.emergency, alignItems: 'center', justifyContent: 'center' },
  sosText: { color: '#1A0A06', fontSize: 11, fontWeight: '900' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '62%', backgroundColor: 'rgba(12,19,46,0.97)', borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line, paddingHorizontal: 20, paddingTop: 8 },
  handleWrap: { alignItems: 'center', gap: 5, paddingBottom: 8 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: colors.line },
  handleText: { color: colors.dim, fontSize: 11, fontWeight: '700' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dest: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  etaRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  eta: { color: colors.ink, fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  away: { color: colors.accent, fontSize: 16, fontWeight: '800', marginBottom: 5 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, padding: 12, gap: 2 },
  statValue: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 2 },
  statNote: { color: colors.dim, fontSize: 11 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  warnText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 17 },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  receiptLine: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  recName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.route, borderColor: colors.route },
  chipText: { color: colors.mute, fontSize: 12, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10 },
  note: { color: colors.dim, fontSize: 11, lineHeight: 16 },
  ring: { width: 124, height: 124, borderRadius: 62, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
