import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Badge, Button, IconButton, Overline, PulseDot, Screen } from '../components/ui';
import { darkMapStyle } from '../lib/mapStyle';
import { colors, radius, type } from '../lib/theme';

type LatLng = { latitude: number; longitude: number };
type Dest = { name: string; latitude: number; longitude: number; radius_m: number };
type Status = 'idle' | 'tracking' | 'arrived';

// Straight-line distance in metres between two GPS points (haversine formula)
function distanceM(a: LatLng, b: LatLng) {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtEta = (s: number) => {
  if (s < 60) return 'under 1 min';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};

export default function LiveMap() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const hits = useRef(0); // consecutive GPS updates inside the arrival circle

  const [me, setMe] = useState<LatLng | null>(null);
  const [speed, setSpeed] = useState(0); // metres per second
  const [dest, setDest] = useState<Dest | null>(null);
  const [places, setPlaces] = useState<Dest[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [denied, setDenied] = useState(false);

  // 1) Live location: ask permission, then listen to GPS updates
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setDenied(true);
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
        (pos) => {
          setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setSpeed(pos.coords.speed && pos.coords.speed > 0 ? pos.coords.speed : 0);
        }
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // 2) Saved places (optional: the map still works if there are none)
  useEffect(() => {
    supabase
      .from('places')
      .select('name,latitude,longitude,arrival_radius')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setPlaces(
            (data as any[]).map((p) => ({ name: p.name, latitude: p.latitude, longitude: p.longitude, radius_m: p.arrival_radius }))
          );
        }
      });
  }, []);

  // 3) Arrival detection: needs 2 updates in a row inside the circle,
  //    so one bad GPS point cannot trigger a false arrival
  useEffect(() => {
    if (status !== 'tracking' || !dest || !me) return;
    if (distanceM(me, dest) <= dest.radius_m) hits.current += 1;
    else hits.current = 0;
    if (hits.current >= 2) {
      setStatus('arrived');
      Alert.alert('You have arrived', `You reached ${dest.name}.`);
    }
  }, [me]);

  function fit(d: Dest) {
    if (!me) return;
    mapRef.current?.fitToCoordinates([me, d], {
      edgePadding: { top: 150, right: 60, bottom: 330, left: 60 },
      animated: true,
    });
  }
  function chooseDest(d: Dest) {
    if (status === 'tracking') return;
    setStatus('idle');
    setDest(d);
    fit(d);
  }
  function onLongPress(e: { nativeEvent: { coordinate: LatLng } }) {
    const c = e.nativeEvent.coordinate;
    chooseDest({ name: 'Custom pin', latitude: c.latitude, longitude: c.longitude, radius_m: 100 });
  }
  function start() {
    if (!me || !dest) return;
    hits.current = 0;
    setStatus('tracking');
  }
  function reset() {
    setStatus('idle');
    setDest(null);
  }
  function recenter() {
    if (me) mapRef.current?.animateToRegion({ ...me, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  }

  if (denied) {
    return (
      <Screen>
        <View style={s.center}>
          <Text style={[type.h2, { textAlign: 'center' }]}>Location permission is needed</Text>
          <Text style={[s.sub, { textAlign: 'center' }]}>Allow location for this app in your phone settings, then come back to the live map.</Text>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 14 }}>
            <Button title="Open phone settings" icon="settings" onPress={() => Linking.openSettings()} />
            <Button title="Back" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }
  if (!me) {
    return (
      <Screen>
        <View style={s.center}>
          <PulseDot color={colors.accent} />
          <Text style={s.sub}>Finding your location…</Text>
        </View>
      </Screen>
    );
  }

  const dist = dest ? distanceM(me, dest) : null;
  const v = speed > 1 ? speed : 1.4; // if standing still, assume walking pace
  const eta = dist !== null ? dist / v : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        initialRegion={{ ...me, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        showsUserLocation
        showsMyLocationButton={false}
        onLongPress={onLongPress}
      >
        {dest && (
          <>
            <Marker coordinate={dest} title={dest.name} pinColor={colors.route} />
            <Circle center={dest} radius={dest.radius_m} strokeColor="rgba(99,165,255,0.95)" fillColor="rgba(71,120,255,0.20)" strokeWidth={2} />
            <Polyline coordinates={[me, dest]} strokeColor={colors.accent} strokeWidth={3} lineDashPattern={[8, 6]} />
          </>
        )}
      </MapView>

      {/* top bar: back + saved places */}
      <View style={[s.top, { top: insets.top + 8 }]}>
        <IconButton icon="back" label="Back" onPress={() => router.back()} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
          {places.map((p, i) => (
            <Pressable key={i} style={[s.pill, dest?.name === p.name && s.pillOn]} onPress={() => chooseDest(p)}>
              <Text style={s.pillText}>{p.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={[s.recenter, { bottom: insets.bottom + 270 }]}>
        <IconButton icon="locate" label="Center on me" onPress={recenter} />
      </View>

      {/* bottom card */}
      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {!dest ? (
          <>
            <Text style={s.title}>Choose a destination</Text>
            <Text style={s.sub}>Tap a saved place above, or long-press anywhere on the map to drop a pin.</Text>
          </>
        ) : status === 'arrived' ? (
          <>
            <Badge label="Arrived" tone="green" icon="checkCircle" caps={false} />
            <Text style={s.title}>You have arrived</Text>
            <Text style={s.sub}>You reached {dest.name}. Location sharing has stopped.</Text>
            <View style={{ marginTop: 10 }}>
              <Button title="Done" onPress={reset} />
            </View>
          </>
        ) : (
          <>
            <Overline>{status === 'tracking' ? 'On the way' : 'Ready'}</Overline>
            <Text style={s.title}>{dest.name}</Text>
            <Text style={s.sub}>
              {fmtDist(dist ?? 0)} remaining  ·  ETA {fmtEta(eta ?? 0)} (estimate)
            </Text>
            <Text style={s.sub}>Arrival circle: {fmtDist(dest.radius_m)}</Text>
            <View style={{ marginTop: 10 }}>
              {status === 'tracking' ? (
                <Button title="Cancel journey" icon="close" variant="danger" onPress={reset} />
              ) : (
                <Button title="Start journey" icon="journey" onPress={start} />
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  top: { position: 'absolute', left: 16, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { height: 40, justifyContent: 'center', backgroundColor: 'rgba(8,13,32,0.9)', borderRadius: radius.pill, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.line },
  pillOn: { backgroundColor: colors.route, borderColor: colors.route },
  pillText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  recenter: { position: 'absolute', right: 16 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,19,46,0.97)', borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.line, padding: 20, gap: 4 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  sub: { color: colors.mute, fontSize: 14, lineHeight: 20 },
});
