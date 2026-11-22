import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Badge, Button, Card, Chip, EmptyState, ErrorNote, Overline, Screen, ScreenHeader } from '../../components/ui';
import { fmtDay, fmtDuration, fmtTime, statusMeta } from '../../lib/format';
import { colors, radius } from '../../lib/theme';
import type { Journey } from '../../lib/types';
import { getJourneyHistory } from '../../services/journeyService';

const PAGE = 20;
type Filter = 'all' | 'arrived' | 'cancelled';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Overline>{label}</Overline>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

export default function History() {
  const [items, setItems] = useState<Journey[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number, f: Filter) => {
    const res = await getJourneyHistory({ limit: PAGE, offset, sort: 'desc', status: f === 'all' ? null : f });
    if (!res.ok) {
      setError(res.error.message);
    } else {
      setError(null);
      setItems((prev) => (offset === 0 ? res.data.items : [...prev, ...res.data.items]));
      setTotal(res.data.total);
    }
    setLoading(false);
    setLoadingMore(false);
  }, []);

  // Reload whenever the tab is shown or the filter changes
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(0, filter);
    }, [load, filter])
  );

  function pick(f: Filter) {
    if (f === filter) return;
    setItems([]);
    setFilter(f);
  }

  function renderItem({ item: j }: { item: Journey }) {
    const m = statusMeta(j.status);
    const endTime = j.status === 'arrived' ? j.arrived_at : j.cancelled_at;
    return (
      <Card style={{ gap: 14 }}>
        <View style={s.top}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.name} numberOfLines={1}>{j.destination_name}</Text>
            <Text style={s.mute}>{fmtDay(j.started_at)}</Text>
          </View>
          <Badge label={m.label} tone={m.tone} caps={false} icon={j.status === 'arrived' ? 'checkCircle' : j.status === 'cancelled' ? 'cancel' : undefined} />
        </View>
        <View style={s.stats}>
          <Stat label="Started" value={fmtTime(j.started_at)} />
          <Stat label={j.status === 'arrived' ? 'Arrived' : j.status === 'cancelled' ? 'Cancelled' : 'Ends'} value={fmtTime(endTime)} />
          <Stat label="Duration" value={fmtDuration(j.duration_seconds)} />
        </View>
      </Card>
    );
  }

  return (
    <Screen tab>
      <ScreenHeader title="History" subtitle={total ? `${total} ${total === 1 ? 'journey' : 'journeys'}` : 'Your past journeys'} />
      <View style={s.chips}>
        <Chip label="All" selected={filter === 'all'} onPress={() => pick('all')} />
        <Chip label="Completed" icon="checkCircle" selected={filter === 'arrived'} onPress={() => pick('arrived')} />
        <Chip label="Cancelled" icon="cancel" selected={filter === 'cancelled'} onPress={() => pick('cancelled')} />
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : error ? (
        <ErrorNote message={error} onRetry={() => { setLoading(true); load(0, filter); }} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(j) => j.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
          ListEmptyComponent={
            <EmptyState
              icon="history"
              title={filter === 'all' ? 'No journeys yet' : 'Nothing here yet'}
              message={filter === 'all' ? 'Completed and cancelled journeys appear here.' : 'No journeys match this filter.'}
            />
          }
          ListFooterComponent={
            items.length < total ? (
              <Button
                title="Load more"
                variant="secondary"
                loading={loadingMore}
                onPress={() => {
                  setLoadingMore(true);
                  load(items.length, filter);
                }}
              />
            ) : undefined
          }
        />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  mute: { color: colors.mute, fontSize: 13 },
  stats: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.lineSoft },
  statValue: { color: colors.ink, fontSize: 14, fontWeight: '700' },
});
