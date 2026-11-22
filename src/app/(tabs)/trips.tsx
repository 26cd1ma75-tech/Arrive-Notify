import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  Badge, Button, Card, EmptyState, ErrorNote, Icon, IconButton, IconTile, SearchBar, Screen, ScreenHeader, SectionHeader,
} from '../../components/ui';
import { categoryOf, categoryRank } from '../../lib/categories';
import { fmtDuration, fmtTime, placeIcon } from '../../lib/format';
import { distanceM, fmtDist, LatLng } from '../../lib/geo';
import { colors } from '../../lib/theme';
import type { Journey, Place } from '../../lib/types';
import { getActiveJourney } from '../../services/journeyService';
import { getSavedPlaces } from '../../services/placesService';
import { getRoute } from '../../services/routingService';

// Estimated drive times are remembered for 10 minutes so the free routing server is not hit on every visit
const etaCache = new Map<string, { at: number; seconds: number }>();
const ETA_TTL = 10 * 60 * 1000;

export default function QuickArrival() {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [active, setActive] = useState<Journey | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [etas, setEtas] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [pl, aj] = await Promise.all([getSavedPlaces(), getActiveJourney()]);
    if (pl.ok) {
      setPlaces(
        [...pl.data].sort(
          (a, b) =>
            Number(b.is_favorite) - Number(a.is_favorite) ||
            categoryRank(a.category) - categoryRank(b.category) ||
            a.name.localeCompare(b.name)
        )
      );
    } else {
      setLoadError(pl.error.message);
    }
    setActive(aj.ok ? aj.data : null);
    setLoading(false);
    setRefreshing(false);
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const last = await Location.getLastKnownPositionAsync();
        if (last) setMe({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      }
    } catch {
      // distance and travel time are optional
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Travel time for the first few places, one request at a time (the free routing server allows 1 per second)
  useEffect(() => {
    if (!me || places.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const p of places.slice(0, 4)) {
        const hit = etaCache.get(p.id);
        if (hit && Date.now() - hit.at < ETA_TTL) {
          setEtas((e) => ({ ...e, [p.id]: hit.seconds }));
          continue;
        }
        const r = await getRoute(me, p);
        if (cancelled) return;
        if (r.ok) {
          etaCache.set(p.id, { at: Date.now(), seconds: r.data.duration_s });
          setEtas((e) => ({ ...e, [p.id]: r.data.duration_s }));
        }
        await new Promise((res) => setTimeout(res, 1100));
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, places]);

  function startFrom(place: Place) {
    router.push({ pathname: '/notify', params: { placeId: place.id, placeName: place.name } });
  }

  const q = query.trim().toLowerCase();
  const shown = q ? places.filter((p) => p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q)) : places;

  return (
    <Screen
      scroll
      tab
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <ScreenHeader
        title="Quick Arrival"
        subtitle="Choose a destination and Arrive Notify handles the rest."
        right={<IconButton icon="map" label="Open live map" onPress={() => router.push('/map')} />}
      />

      {active && (
        <Card tone="selected" style={{ gap: 10, marginBottom: 20 }}>
          <View style={s.rowBetween}>
            <Badge label="In transit" tone="blue" dot />
            <Text style={s.mute}>Started {fmtTime(active.started_at)}</Text>
          </View>
          <Text style={s.activeTitle} numberOfLines={2}>Heading to {active.destination_name}</Text>
          <Text style={s.mute}>
            {[
              active.route_distance_m ? fmtDist(active.route_distance_m) : null,
              active.eta_seconds ? `${fmtDuration(active.eta_seconds)} planned` : null,
            ].filter(Boolean).join('  •  ') || 'Tracking in progress'}
          </Text>
          <Button title="View Live Tracking" icon="radar" onPress={() => router.push({ pathname: '/journey', params: { id: active.id } })} />
        </Card>
      )}

      {places.length > 3 && (
        <View style={{ marginBottom: 14 }}>
          <SearchBar value={query} onChangeText={setQuery} placeholder="Search your places" />
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 30 }} />
      ) : loadError ? (
        <ErrorNote message={loadError} onRetry={() => { setLoading(true); load(); }} />
      ) : places.length === 0 ? (
        <Card>
          <EmptyState
            icon="pin"
            title="No places saved yet"
            message="Add your first place, like Home or Office, to start journeys with one tap."
          />
        </Card>
      ) : shown.length === 0 ? (
        <Text style={[s.mute, { textAlign: 'center', marginVertical: 24 }]}>No places match “{query}”.</Text>
      ) : (
        <View style={{ gap: 14 }}>
          {shown.map((p) => {
            const cat = categoryOf(p.category);
            const eta = etas[p.id];
            return (
              <Card key={p.id} style={{ gap: 14 }}>
                <View style={s.placeTop}>
                  <IconTile icon={placeIcon(p.category)} tone="blue" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={s.nameRow}>
                      <Text style={s.placeName} numberOfLines={1}>{p.name}</Text>
                      {p.is_favorite ? <Icon name="star" size={14} color={colors.warning} /> : null}
                    </View>
                    <Text style={s.mute} numberOfLines={1}>{p.address || 'No address saved'}</Text>
                  </View>
                  <Badge label={cat.label} tone="neutral" />
                </View>
                <View style={s.meta}>
                  <View style={s.metaItem}>
                    <Icon name="locate" size={14} color={colors.dim} />
                    <Text style={s.metaText}>{me ? `${fmtDist(distanceM(me, p))} away` : 'Distance unavailable'}</Text>
                  </View>
                  <View style={s.metaItem}>
                    <Icon name="clock" size={14} color={colors.dim} />
                    <Text style={s.metaText}>{eta != null ? `About ${fmtDuration(eta)} by road` : 'Travel time unavailable'}</Text>
                  </View>
                </View>
                <Button title="Start Journey" icon="journey" onPress={() => startFrom(p)} />
              </Card>
            );
          })}
        </View>
      )}

      <SectionHeader title="Your places" />
      <View style={{ gap: 10 }}>
        <Button
          title="Add New Place"
          icon="add"
          variant="secondary"
          onPress={() => router.push({ pathname: '/places', params: { add: '1' } })}
        />
        <Button title="Manage saved places" icon="settings" variant="ghost" onPress={() => router.push('/places')} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  mute: { color: colors.mute, fontSize: 13 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  placeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  placeName: { color: colors.ink, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: colors.mute, fontSize: 12, fontWeight: '600' },
});
