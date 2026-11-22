import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorNote, GradientView, Icon, IconTile, ListRow, Overline,
  ProgressBar, PulseDot, Screen, SectionHeader,
} from '../../components/ui';
import AnimatedLogo, { Reveal, Wordmark } from '../../components/brand/AnimatedLogo';
import { useIntroDone } from '../../components/brand/intro';
import { useAuth } from '../../lib/auth';
import { categoryOf, categoryRank } from '../../lib/categories';
import { fmtDay, fmtDuration, fmtTime, greeting, placeIcon, statusMeta } from '../../lib/format';
import { distanceM, fmtDist, LatLng } from '../../lib/geo';
import { usePrefs } from '../../lib/prefs';
import { colors, radius, type } from '../../lib/theme';
import type { AppNotification, Journey, JourneyRecipient, Place } from '../../lib/types';
import { getActiveJourney, getJourneyHistory } from '../../services/journeyService';
import { getSavedPlaces } from '../../services/placesService';
import { subscribeToMyNotifications } from '../../services/realtimeService';
import { getJourneyRecipients } from '../../services/trackingService';

export default function Home() {
  const { session } = useAuth();
  const router = useRouter();
  const { prefs } = usePrefs();
  const name = session?.user.user_metadata?.name ?? 'there';
  const focused = useIsFocused(); // logo loops pause while this tab is hidden
  const { width } = useWindowDimensions();
  const introDone = useIntroDone(); // sections reveal as the brand intro fades

  const [places, setPlaces] = useState<Place[]>([]);
  const [active, setActive] = useState<Journey | null>(null);
  const [recipients, setRecipients] = useState<JourneyRecipient[]>([]);
  const [recent, setRecent] = useState<Journey[]>([]);
  const [me, setMe] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<AppNotification | null>(null);

  // A journey update for me arrives while Home is open
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    return subscribeToMyNotifications(userId, (n) => {
      const urgent = n.type === 'sos' || n.type === 'sos_resolved'; // emergencies are never hidden
      const wanted: Record<string, boolean> = {
        started: prefs.notifyStarted,
        nearby: prefs.notifyNearby,
        arrived: prefs.notifyArrived,
        cancelled: prefs.notifyCancelled,
      };
      if (urgent || (prefs.journeyUpdates && (wanted[n.type] ?? true))) setIncoming(n);
    });
  }, [userId, prefs.journeyUpdates, prefs.notifyStarted, prefs.notifyNearby, prefs.notifyArrived, prefs.notifyCancelled]);

  const load = useCallback(async () => {
    setLoadError(null);
    const [pl, aj, hist] = await Promise.all([getSavedPlaces(), getActiveJourney(), getJourneyHistory({ limit: 3 })]);
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
    const act = aj.ok ? aj.data : null;
    setActive(act);
    setRecent(hist.ok ? hist.data.items : []);
    if (act) {
      const r = await getJourneyRecipients(act.id);
      setRecipients(r.ok ? r.data : []);
    } else {
      setRecipients([]);
    }
    setLoading(false);
    setRefreshing(false);
    // Distance on each tile: only if location permission was already granted
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const last = await Location.getLastKnownPositionAsync();
        if (last) setMe({ latitude: last.coords.latitude, longitude: last.coords.longitude });
      }
    } catch {
      // distance is optional
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Start Journey: first choose who to notify (groups / people), then the journey starts there
  function startFrom(place: Place) {
    router.push({ pathname: '/notify', params: { placeId: place.id, placeName: place.name } });
  }

  const sharing = active?.share_live_location === true;

  // Progress from the straight-line distance between start, you and the destination
  let progress: number | null = null;
  if (active && me && active.start_latitude != null && active.start_longitude != null) {
    const dest = { latitude: active.destination_latitude, longitude: active.destination_longitude };
    const total = distanceM({ latitude: active.start_latitude, longitude: active.start_longitude }, dest);
    if (total > 30) progress = Math.max(0, Math.min(1, 1 - distanceM(me, dest) / total));
  }

  const detail = (() => {
    if (!active) return '';
    const parts: string[] = [];
    if (active.route_distance_m) parts.push(fmtDist(active.route_distance_m));
    if (active.eta_seconds) parts.push(`${fmtDuration(active.eta_seconds)} planned`);
    return parts.length ? parts.join('  •  ') : 'Tracking in progress';
  })();

  const recipLine = (() => {
    if (!recipients.length) return 'No one selected for this journey';
    const names = recipients.slice(0, 2).map((r) => r.recipient_name).join(' & ');
    const more = recipients.length > 2 ? ` +${recipients.length - 2}` : '';
    return `${names}${more} ${sharing ? 'can watch live' : 'notified'}`;
  })();

  const shown = places.slice(0, 4);

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
      {/* Top bar: brand, sharing status, SOS */}
      <Reveal index={0} when={introDone}>
      <View style={s.top}>
        <View style={s.brand}>
          <AnimatedLogo size={34} delay={120} active={focused} />
          {width >= 360 && (
            <View style={{ marginLeft: 8 }}>
              <Wordmark fontSize={16} delay={380} />
            </View>
          )}
        </View>
        <View style={s.topRight}>
          <View style={[s.status, sharing && s.statusOn]}>
            <PulseDot color={sharing ? colors.success : colors.dim} active={sharing} />
            <Text style={[s.statusText, sharing && { color: colors.success }]}>{sharing ? 'Sharing live' : 'Not sharing'}</Text>
          </View>
          <Pressable style={s.sos} onPress={() => router.push('/sos')} accessibilityRole="button" accessibilityLabel="Emergency SOS">
            <Text style={s.sosText}>SOS</Text>
          </Pressable>
        </View>
      </View>
      </Reveal>

      {/* Greeting */}
      <Reveal index={1} when={introDone}>
      <View style={s.greet}>
        <Avatar name={name} px={48} />
        <View style={{ flex: 1 }}>
          <Text style={s.mute}>{greeting()},</Text>
          <Text style={type.h1} numberOfLines={1}>{name}</Text>
        </View>
      </View>

      {incoming && (
        <Card
          tone={incoming.type === 'sos' || incoming.type === 'sos_resolved' ? 'emergency' : 'selected'}
          style={{ marginBottom: 16, gap: 6 }}
          onPress={() => {
            const target = incoming;
            setIncoming(null);
            if (target.sos_alert_id) router.push({ pathname: '/sos-view', params: { id: target.sos_alert_id } });
            else router.push('/shared');
          }}
        >
          <Badge label={incoming.type === 'sos' ? 'Emergency' : 'New update'} tone={incoming.type === 'sos' ? 'orange' : 'blue'} dot />
          <Text style={s.bannerText}>{incoming.message}</Text>
          <Text style={s.mute}>Tap to open</Text>
        </Card>
      )}
      </Reveal>

      {/* Current journey status */}
      <Reveal index={2} when={introDone}>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 40 }} />
      ) : active ? (
        <Pressable onPress={() => router.push({ pathname: '/journey', params: { id: active.id } })}>
          <GradientView from="#6491FF" to="#3558D6" style={s.hero}>
            <View style={s.heroTop}>
              <View style={s.heroChip}>
                <Text style={s.heroChipText}>ACTIVE JOURNEY</Text>
              </View>
              {active.estimated_arrival_at ? <Text style={s.heroEta}>ETA {fmtTime(active.estimated_arrival_at)}</Text> : null}
            </View>
            <Text style={s.heroTitle} numberOfLines={2}>Heading to {active.destination_name}</Text>
            <Text style={s.heroSub}>{detail}</Text>
            {progress != null ? (
              <View style={{ marginTop: 14 }}>
                <ProgressBar value={progress} tone="light" />
              </View>
            ) : null}
            <View style={s.heroFoot}>
              <Icon name="checkCircle" size={16} color="#FFFFFF" />
              <Text style={s.heroFootText} numberOfLines={1}>{recipLine}</Text>
              <View style={s.heroBtn}>
                <Text style={s.heroBtnText}>View live</Text>
                <Icon name="chevron" size={14} color="#FFFFFF" />
              </View>
            </View>
          </GradientView>
        </Pressable>
      ) : (
        <GradientView from="#1F3173" to="#142048" style={[s.hero, { borderWidth: 1, borderColor: colors.line }]}>
          <Overline color={colors.accent}>Ready when you are</Overline>
          <Text style={[s.heroTitle, { marginTop: 8 }]}>Where are you headed?</Text>
          <Text style={s.heroSub}>Pick a saved place and your people are told when you arrive. Don’t text, just arrive.</Text>
          <Button title="Start Journey" icon="journey" onPress={() => router.push('/trips')} style={{ marginTop: 18 }} />
        </GradientView>
      )}
      </Reveal>

      {/* Add People (QR code) */}
      <Reveal index={3} when={introDone}>
      <Card tone="selected" style={s.addPeople} onPress={() => router.push('/add-people')}>
        <IconTile icon="qr" tone="blue" px={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.addTitle}>Add People</Text>
          <Text style={s.mute}>Connect with a QR code. No emails to type.</Text>
        </View>
        <View style={s.addPill}>
          <Icon name="personAdd" size={16} color="#FFFFFF" />
          <Text style={s.addPillText}>Add</Text>
        </View>
      </Card>
      </Reveal>

      {/* Quick Arrival */}
      <Reveal index={4} when={introDone}>
      <SectionHeader title="Quick Arrival" action="Manage" onAction={() => router.push('/places')} />
      {loadError ? (
        <ErrorNote message={loadError} onRetry={() => { setLoading(true); load(); }} />
      ) : !loading && places.length === 0 ? (
        <Card>
          <EmptyState
            icon="pin"
            title="No places saved yet"
            message="Add Home, Office or College to start journeys with one tap."
            action={<Button title="Add New Place" icon="add" onPress={() => router.push({ pathname: '/places', params: { add: '1' } })} />}
          />
        </Card>
      ) : (
        <>
          <View style={s.grid}>
            {shown.map((p) => {
              const cat = categoryOf(p.category);
              return (
                <Card key={p.id} style={s.tile} onPress={() => startFrom(p)}>
                  <View style={s.tileTop}>
                    <IconTile icon={placeIcon(p.category)} tone="blue" px={40} />
                    {p.is_favorite ? <Badge label="Saved" tone="blue" icon="star" /> : null}
                  </View>
                  <Text style={s.tileName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.tileSub} numberOfLines={1}>
                    {me ? `${fmtDist(distanceM(me, p))} away` : cat.label}
                  </Text>
                </Card>
              );
            })}
          </View>
          <Button
            title="Add New Place"
            icon="add"
            variant="secondary"
            small
            full={false}
            style={{ marginTop: 12 }}
            onPress={() => router.push({ pathname: '/places', params: { add: '1' } })}
          />
        </>
      )}
      </Reveal>

      {/* Emergency shortcut */}
      <Reveal index={5} when={introDone}>
      <View style={{ height: 16 }} />
      <Card tone="emergency" onPress={() => router.push('/sos')} style={s.sosCard}>
        <IconTile icon="sos" tone="orange" px={44} />
        <View style={{ flex: 1 }}>
          <Text style={s.sosTitle}>Emergency SOS</Text>
          <Text style={s.mute}>Alert your emergency contacts with your location</Text>
        </View>
        <Icon name="chevron" size={16} color={colors.emergency} />
      </Card>

      <View style={{ height: 12 }} />
      <Card style={{ paddingVertical: 4 }}>
        <ListRow icon="radar" title="Shared with me" subtitle="Journeys and alerts from people you follow" onPress={() => router.push('/shared')} last />
      </Card>
      </Reveal>

      {/* Recent journeys */}
      <Reveal index={6} when={introDone}>
      {recent.length > 0 && (
        <>
          <SectionHeader title="Recent journeys" action="View all" onAction={() => router.push('/history')} />
          <View style={{ gap: 10 }}>
            {recent.map((j) => {
              const m = statusMeta(j.status);
              return (
                <Card key={j.id} style={s.recent}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.recentName} numberOfLines={1}>{j.destination_name}</Text>
                    <Text style={s.mute}>
                      {fmtDay(j.started_at)}
                      {j.duration_seconds != null ? `  •  ${fmtDuration(j.duration_seconds)}` : ''}
                    </Text>
                  </View>
                  <Badge label={m.label} tone={m.tone} caps={false} />
                </Card>
              );
            })}
          </View>
        </>
      )}
      </Reveal>
    </Screen>
  );
}

const s = StyleSheet.create({
  addPeople: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  addTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.route, borderRadius: radius.pill, paddingHorizontal: 14, height: 36 },
  addPillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  logo: { width: 28, height: 28, borderRadius: 9, backgroundColor: colors.route, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: colors.ink, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 11, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  statusOn: { backgroundColor: colors.successSoft, borderColor: '#1E6F5E' },
  statusText: { color: colors.mute, fontSize: 12, fontWeight: '700' },
  sos: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.emergency, alignItems: 'center', justifyContent: 'center' },
  sosText: { color: '#1A0A06', fontSize: 11, fontWeight: '900', letterSpacing: 0.3 },
  greet: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  mute: { color: colors.mute, fontSize: 13 },
  bannerText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  hero: { borderRadius: radius.xl, padding: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroChip: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  heroChipText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  heroEta: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  heroTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 14 },
  heroSub: { color: 'rgba(255,255,255,0.82)', fontSize: 14, marginTop: 4, lineHeight: 20 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  heroFootText: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: 12, height: 32 },
  heroBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: '45%', gap: 4, padding: 14 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  tileName: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  tileSub: { color: colors.mute, fontSize: 12 },
  sosCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sosTitle: { color: '#FFD2C7', fontSize: 16, fontWeight: '800' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  recentName: { color: colors.ink, fontSize: 15, fontWeight: '700' },
});
