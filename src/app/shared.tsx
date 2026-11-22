import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { Avatar, Badge, Card, EmptyState, ErrorNote, Icon, IconTile, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { colors } from '../lib/theme';
import { getSharedJourneys } from '../services/trackingService';
import { getNotificationHistory } from '../services/notificationService';
import { subscribeToMyNotifications, subscribeToMySosAlerts } from '../services/realtimeService';
import { getSosAlertsForMe } from '../services/sosService';
import type { AppNotification, LiveJourney, SosAlert } from '../lib/types';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'neutral' }> = {
  active: { label: 'Live', tone: 'green' },
  sharing_stopped: { label: 'Sharing stopped', tone: 'amber' },
  arrived: { label: 'Arrived', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export default function SharedWithMe() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id;
  const [journeys, setJourneys] = useState<LiveJourney[]>([]);
  const [updates, setUpdates] = useState<AppNotification[]>([]);
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [j, n, a] = await Promise.all([getSharedJourneys(), getNotificationHistory(30), getSosAlertsForMe()]);
    if (a.ok) setSosAlerts(a.data);
    if (j.ok) {
      setJourneys(j.data);
      setError(null);
    } else {
      setError(j.error.message);
    }
    if (n.ok) setUpdates(n.data.filter((x) => x.recipient_id === uid));
    setLoading(false);
    setRefreshing(false);
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // a new update arrives while this screen is open
  useEffect(() => {
    if (!uid) return;
    const offNotifications = subscribeToMyNotifications(uid, () => load());
    const offSos = subscribeToMySosAlerts(() => load());
    return () => {
      offNotifications();
      offSos();
    };
  }, [uid, load]);

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <ScreenHeader
        title="Shared with me"
        subtitle="Journeys people chose to share with you. You can only see a journey while the traveller keeps sharing it."
        onBack={() => router.back()}
      />

      {sosAlerts.length > 0 && (
        <>
          <SectionHeader title="Emergency alerts" />
          <View style={{ gap: 10 }}>
            {sosAlerts.map((a) => {
              const live = a.status === 'active' && new Date(a.expires_at).getTime() > Date.now();
              return (
                <Card
                  key={a.id}
                  tone={live ? 'emergency' : 'default'}
                  style={s.item}
                  onPress={() => router.push({ pathname: '/sos-view', params: { id: a.id } })}
                >
                  <IconTile icon="sos" tone={live ? 'orange' : 'neutral'} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={s.badgeRow}>
                      <Badge label={live ? 'Emergency' : a.status === 'resolved' ? 'Resolved' : 'Ended'} tone={live ? 'orange' : 'neutral'} dot={live} />
                    </View>
                    <Text style={s.name}>{a.sender_name}</Text>
                    <Text style={s.mute}>{new Date(a.created_at).toLocaleString()}</Text>
                  </View>
                  <Icon name="chevron" size={16} color={colors.dim} />
                </Card>
              );
            })}
          </View>
        </>
      )}

      <SectionHeader title="Journeys" />
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : error ? (
        <ErrorNote message={error} />
      ) : journeys.length === 0 ? (
        <Card>
          <EmptyState icon="radar" title="Nothing shared with you right now" message="When someone starts a journey and shares it with you, it appears here." />
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {journeys.map((j) => {
            const st = STATUS[j.status] ?? STATUS.cancelled;
            const open = j.status === 'active' || j.status === 'sharing_stopped';
            return (
              <Card key={j.journey_id} style={s.item} onPress={() => router.push({ pathname: '/track', params: { id: j.journey_id } })}>
                <Avatar name={j.traveller_name} px={44} tone={j.status === 'active' ? 'green' : 'blue'} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.badgeRow}>
                    <Badge label={st.label} tone={st.tone} dot={j.status === 'active'} />
                  </View>
                  <Text style={s.name}>{j.traveller_name}</Text>
                  <Text style={s.mute}>
                    {open ? `Going to ${j.destination_name}` : j.status === 'arrived' ? `Arrived at ${j.destination_name}` : `Cancelled the journey to ${j.destination_name}`}
                  </Text>
                </View>
                <Icon name="chevron" size={16} color={colors.dim} />
              </Card>
            );
          })}
        </View>
      )}

      {updates.length > 0 && (
        <>
          <SectionHeader title="Recent updates" />
          <View style={{ gap: 8 }}>
            {updates.slice(0, 15).map((n) => (
              <Card key={n.id} tone="flat" style={{ gap: 2, padding: 14 }}>
                <Text style={s.updateText}>{n.message}</Text>
                <Text style={s.mute}>{new Date(n.created_at).toLocaleString()}</Text>
              </Card>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeRow: { flexDirection: 'row' },
  mute: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  updateText: { color: colors.ink, fontSize: 14, lineHeight: 20 },
});
