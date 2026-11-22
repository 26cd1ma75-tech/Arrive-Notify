import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Avatar, Badge, Button, Card, Icon, IconButton, Overline, PulseDot, Screen } from '../components/ui';
import { fmtTime } from '../lib/format';
import { darkMapStyle } from '../lib/mapStyle';
import { colors, radius, type } from '../lib/theme';
import { distanceM, fmtDist, LatLng } from '../lib/geo';
import { STALE_AFTER_MS } from '../lib/trackingConfig';
import { getSharedJourney, getSharedRoute } from '../services/trackingService';
import { subscribeToLiveJourney } from '../services/realtimeService';
import { decodePolyline, routingAttribution } from '../services/routingService';
import type { LiveJourney } from '../lib/types';

function ago(iso: string | null, now: number) {
  if (!iso) return 'no update yet';
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec} s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  return `${Math.floor(sec / 3600)} h ago`;
}

export default function TrackJourney() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const routeVersion = useRef(-1);
  const fitted = useRef(false);

  const [live, setLive] = useState<LiveJourney | null>(null);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState('CONNECTING');
  const [now, setNow] = useState(Date.now());
  const [sheetH, setSheetH] = useState(0); // measured height of the bottom panel (0 until laid out)
  const [expanded, setExpanded] = useState(false);

  const loadRoute = useCallback(async () => {
    const res = await getSharedRoute(String(id));
    if (res.ok) setPoints(res.data.polyline ? decodePolyline(res.data.polyline) : []);
  }, [id]);

  const apply = useCallback(
    (row: LiveJourney) => {
      setLive(row);
      setError(null);
      if (row.status !== 'active') {
        setPoints([]);
      } else if (row.route_version !== routeVersion.current) {
        routeVersion.current = row.route_version;
        loadRoute();
      }
    },
    [loadRoute]
  );

  const refresh = useCallback(async () => {
    const res = await getSharedJourney(String(id));
    if (res.ok) apply(res.data);
    else setError(res.error.message);
    setLoading(false);
  }, [id, apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: new positions arrive here as soon as the traveller's phone saves them
  useEffect(() => subscribeToLiveJourney(String(id), apply, setChannel), [id, apply]);

  // "Updated 12 s ago" keeps counting
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // If Realtime is not connected, fall back to checking every 20 seconds
  useEffect(() => {
    if (channel === 'SUBSCRIBED') return;
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [channel, refresh]);

  const traveller: LatLng | null = live && live.latitude != null && live.longitude != null ? { latitude: live.latitude, longitude: live.longitude } : null;
  const dest: LatLng | null = live && live.destination_latitude != null && live.destination_longitude != null ? { latitude: live.destination_latitude, longitude: live.destination_longitude } : null;

  useEffect(() => {
    // frame the traveller and the destination inside the visible part of the map, above the panel
    if (!fitted.current && sheetH > 0 && traveller && dest) {
      fitted.current = true;
      mapRef.current?.fitToCoordinates([traveller, dest], { edgePadding: { top: 120, right: 60, bottom: sheetH + 50, left: 60 }, animated: true });
    }
  }, [traveller?.latitude, dest?.latitude, sheetH]);

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
  if (error && !live) {
    return (
      <Screen>
        <View style={s.center}>
          <Text style={type.h2}>Cannot show this journey</Text>
          <Text style={[s.sub, { textAlign: 'center' }]}>{error}</Text>
          <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
            <Button title="Back" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }
  if (!live) return null;

  const active = live.status === 'active';
  const showMap = active || live.status === 'sharing_stopped';
  const ageSec = live.position_updated_at ? (now - new Date(live.position_updated_at).getTime()) / 1000 : null;
  const stale = active && (ageSec == null || ageSec * 1000 > STALE_AFTER_MS);
  const straight = traveller && dest ? distanceM(traveller, dest) : null;
  const etaMin = live.eta_seconds != null ? Math.max(1, Math.round(live.eta_seconds / 60)) : null;
  const badge: { label: string; tone: 'green' | 'amber' | 'neutral' } = active
    ? { label: 'Live', tone: 'green' }
    : live.status === 'sharing_stopped'
      ? { label: 'Sharing stopped', tone: 'amber' }
      : live.status === 'arrived'
        ? { label: 'Arrived', tone: 'green' }
        : { label: 'Cancelled', tone: 'neutral' };
  const headline = showMap
    ? `Travelling to ${live.destination_name}`
    : live.status === 'arrived'
      ? `Arrived at ${live.destination_name}`
      : `Cancelled the journey to ${live.destination_name}`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {showMap ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          customMapStyle={darkMapStyle}
          userInterfaceStyle="dark"
          initialRegion={{ ...(dest ?? traveller ?? { latitude: 20, longitude: 78 }), latitudeDelta: dest || traveller ? 0.05 : 30, longitudeDelta: dest || traveller ? 0.05 : 30 }}
          showsMyLocationButton={false}
        >
          {points.length > 1 && <Polyline coordinates={points} strokeColor={colors.accent} strokeWidth={5} />}
          {dest && <Marker coordinate={dest} title={live.destination_name} pinColor={colors.route} />}
          {traveller && <Marker coordinate={traveller} title={live.traveller_name} pinColor={colors.success} />}
        </MapView>
      ) : (
        <Screen><View /></Screen>
      )}

      <View style={[s.top, { top: insets.top + 8 }]}>
        <IconButton icon="back" label="Back" onPress={() => router.back()} />
        <View style={s.live}>
          <PulseDot color={channel === 'SUBSCRIBED' ? colors.success : colors.warning} active={channel === 'SUBSCRIBED'} />
          <Text style={[s.liveText, { color: channel === 'SUBSCRIBED' ? colors.success : colors.warning }]}>
            {channel === 'SUBSCRIBED' ? 'LIVE TRACKING' : 'RECONNECTING'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View
        style={[s.sheet, showMap ? { bottom: 0, paddingBottom: insets.bottom + 12 } : { top: insets.top + 80, paddingTop: 18 }]}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
      >
        {active && (
          <Pressable
            onPress={() => setExpanded((x) => !x)}
            hitSlop={8}
            style={s.handleWrap}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide details' : 'Show details'}
          >
            <View style={s.handle} />
            <Text style={s.handleText}>{expanded ? 'Hide details' : 'Details'}</Text>
          </Pressable>
        )}
        <View style={s.head}>
          <Avatar name={live.traveller_name} px={46} tone={active ? 'green' : 'blue'} />
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{live.traveller_name}</Text>
            <Text style={s.sub} numberOfLines={2}>{headline}</Text>
          </View>
          <Badge label={badge.label} tone={badge.tone} dot={active} />
        </View>

        {active && (
          <>
            <View style={s.stats}>
              <View style={s.stat}>
                <Overline>ETA</Overline>
                <Text style={s.statValue}>{live.estimated_arrival_at ? fmtTime(live.estimated_arrival_at) : '–'}</Text>
                <Text style={s.statNote}>{etaMin != null ? `about ${etaMin} min` : 'unavailable'}</Text>
              </View>
              <View style={s.stat}>
                <Overline>Distance</Overline>
                <Text style={s.statValue}>{live.route_distance_m != null ? fmtDist(live.route_distance_m) : straight != null ? fmtDist(straight) : '–'}</Text>
                <Text style={s.statNote}>{live.route_distance_m != null ? 'by road' : straight != null ? 'straight line' : ' '}</Text>
              </View>
              <View style={s.stat}>
                <Overline>Updated</Overline>
                <Text style={s.statValue}>{ago(live.position_updated_at, now)}</Text>
                <Text style={s.statNote}>{stale ? 'outdated' : ' '}</Text>
              </View>
            </View>
            {live.estimated_arrival_at == null && <Warn text="The arrival time cannot be calculated right now." />}
            {stale && <Warn text="This location is outdated. The traveller may have no signal or closed the app." />}
            {expanded && (
              <Text style={s.note}>
                Started at {fmtTime(live.started_at)}. You can see this because {live.traveller_name} chose to share it with you. {routingAttribution}.
              </Text>
            )}
          </>
        )}
        {live.status === 'sharing_stopped' && <Warn text={`${live.traveller_name} stopped sharing the live location. The journey may still be in progress.`} />}
        {(live.status === 'arrived' || live.status === 'cancelled') && (
          <Text style={s.note}>Live location sharing has ended and the location was removed.</Text>
        )}
      </View>
    </View>
  );
}

function Warn({ text }: { text: string }) {
  return (
    <Card tone="flat" style={s.warn}>
      <Icon name="warning" size={16} color={colors.warning} />
      <Text style={s.warnText}>{text}</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(8,13,32,0.9)', borderWidth: 1, borderColor: colors.line },
  liveText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  sheet: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(12,19,46,0.97)', borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 20, paddingTop: 8, gap: 10 },
  handleWrap: { alignItems: 'center', gap: 5, paddingBottom: 2 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: colors.line },
  handleText: { color: colors.dim, fontSize: 11, fontWeight: '700' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  sub: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, padding: 12, gap: 2 },
  statValue: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 2 },
  statNote: { color: colors.dim, fontSize: 11 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  warnText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 17 },
  note: { color: colors.dim, fontSize: 11, lineHeight: 16 },
});
