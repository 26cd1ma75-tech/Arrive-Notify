import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  Avatar, Badge, Button, Card, Chip, ConfirmModal, Icon, IconTile, ListRow, Overline, PulseDot, Screen, ScreenHeader,
  SectionHeader, ToggleRow,
} from '../components/ui';
import { type RetentionDays, type SosCountdown, usePrefs } from '../lib/prefs';
import { colors, type } from '../lib/theme';
import type { Journey, JourneyRecipient, SosAlert } from '../lib/types';
import { getActiveJourney } from '../services/journeyService';
import { clearMyLocationHistory, isMissingRpc, revokeJourneyViewer } from '../services/privacyService';
import { getActiveSos } from '../services/sosService';
import { getJourneyRecipients, setJourneySharing } from '../services/trackingService';

type Perm = { status: 'granted' | 'denied' | 'undetermined'; precise: boolean | null; canAsk: boolean };

const RETENTION: { v: RetentionDays; label: string }[] = [
  { v: 0, label: 'When it ends' },
  { v: 1, label: '1 day' },
  { v: 7, label: '7 days' },
  { v: 30, label: '30 days' },
];
const COUNTDOWNS: SosCountdown[] = [3, 5, 10];

const SETUP_MSG = 'This needs the privacy update. Run privacy-backend.sql once in your Supabase SQL Editor, then try again.';

export default function Privacy() {
  const router = useRouter();
  const { prefs, update, sync, syncNow } = usePrefs();

  const [loading, setLoading] = useState(true);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [recipients, setRecipients] = useState<JourneyRecipient[]>([]);
  const [sos, setSos] = useState<{ alert: SosAlert; count: number } | null>(null);
  const [perm, setPerm] = useState<Perm>({ status: 'undetermined', precise: null, canAsk: true });
  const [confirm, setConfirm] = useState<null | 'stopAll' | 'clear'>(null);
  const [viewerToRemove, setViewerToRemove] = useState<JourneyRecipient | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [aj, as] = await Promise.all([getActiveJourney(), getActiveSos()]);
    const j = aj.ok ? aj.data : null;
    setJourney(j);
    if (j) {
      const r = await getJourneyRecipients(j.id);
      setRecipients(r.ok ? r.data : []);
    } else {
      setRecipients([]);
    }
    const a = as.ok ? as.data.alert : null;
    setSos(a && a.status === 'active' && new Date(a.expires_at).getTime() > Date.now() ? { alert: a, count: as.ok ? as.data.recipients.length : 0 } : null);
    try {
      const p = await Location.getForegroundPermissionsAsync();
      setPerm({
        status: p.status === 'granted' ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined',
        precise: p.android ? p.android.accuracy === 'fine' : null,
        canAsk: p.canAskAgain,
      });
    } catch {
      // permission info is optional
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const sharing = journey?.share_live_location === true;
  const viewers = recipients.filter((r) => r.can_track);

  async function stopAllSharing() {
    setBusy(true);
    let error: string | null = null;
    if (journey && sharing) {
      const res = await setJourneySharing(journey.id, false);
      if (!res.ok) error = res.error.message;
    }
    setBusy(false);
    setConfirm(null);
    if (error) Alert.alert('Could not stop sharing', error);
    else load();
  }

  async function removeViewer() {
    const v = viewerToRemove;
    if (!v || !journey || !v.recipient_id) return;
    setBusy(true);
    const res = await revokeJourneyViewer(journey.id, v.recipient_id);
    setBusy(false);
    setViewerToRemove(null);
    if (!res.ok) Alert.alert(isMissingRpc(res.error) ? 'Update needed' : 'Could not remove', isMissingRpc(res.error) ? SETUP_MSG : res.error.message);
    else load();
  }

  async function clearHistory() {
    setBusy(true);
    const res = await clearMyLocationHistory();
    setBusy(false);
    setConfirm(null);
    if (!res.ok) Alert.alert(isMissingRpc(res.error) ? 'Update needed' : 'Could not delete', isMissingRpc(res.error) ? SETUP_MSG : res.error.message);
    else Alert.alert('Location history deleted', `${res.data.deleted_points} saved GPS points were removed. Your journey summaries in History are unchanged.`);
  }

  async function askPermission() {
    if (perm.status === 'denied' && !perm.canAsk) {
      Linking.openSettings();
      return;
    }
    await Location.requestForegroundPermissionsAsync();
    load();
  }

  const groupsCount = prefs.defaultGroupIds.length;
  const peopleCount = prefs.defaultPersonIds.length;
  const recipientSummary =
    groupsCount + peopleCount === 0
      ? 'None. You choose each time.'
      : [groupsCount ? `${groupsCount} ${groupsCount === 1 ? 'group' : 'groups'}` : null, peopleCount ? `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}` : null].filter(Boolean).join(', ');
  const alertTypes = [prefs.notifyStarted, prefs.notifyNearby, prefs.notifyArrived, prefs.notifyCancelled].filter(Boolean).length;
  const retentionText =
    prefs.retentionDays === 0
      ? 'GPS points are deleted as soon as a journey ends.'
      : `GPS points are deleted ${prefs.retentionDays} ${prefs.retentionDays === 1 ? 'day' : 'days'} after they are recorded.`;

  return (
    <Screen scroll>
      <ScreenHeader title="Privacy Settings" subtitle="You decide who sees your location, and for how long." onBack={() => router.back()} />

      {sync === 'needs-setup' && (
        <Card tone="flat" style={s.banner}>
          <Icon name="info" size={18} color={colors.warning} />
          <Text style={s.bannerText}>
            Your choices are saved on this phone only. To sync them and turn on data deletion, export and account removal, run privacy-backend.sql once in your Supabase SQL Editor.
          </Text>
        </Card>
      )}
      {sync === 'local-only' && (
        <Card tone="flat" style={s.banner}>
          <Icon name="wifiOff" size={18} color={colors.warning} />
          <Text style={s.bannerText}>Could not reach the server. Your choices are saved on this phone.</Text>
          <Button title="Try again" small variant="secondary" full={false} onPress={syncNow} />
        </Card>
      )}

      {/* Live status + kill switch */}
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 40 }} />
      ) : sharing || sos ? (
        <Card tone={sos ? 'emergency' : 'success'} style={{ gap: 12 }}>
          <View style={s.row}>
            <PulseDot color={sos ? colors.emergency : colors.success} />
            <Text style={s.liveTitle}>Location sharing is ON</Text>
          </View>
          <Text style={s.body}>
            {sharing && journey ? `Your live location is shared for the journey to ${journey.destination_name}. ` : ''}
            {sos ? 'Your emergency alert is also sharing your location with your emergency contacts.' : ''}
          </Text>
          {sharing && <Button title="Stop all sharing now" icon="stop" variant="danger" onPress={() => setConfirm('stopAll')} />}
          {sos && <Button title="Open emergency screen" icon="sos" variant="secondary" onPress={() => router.push('/sos')} />}
        </Card>
      ) : (
        <Card style={s.row}>
          <IconTile icon="shieldCheck" tone="green" px={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.liveTitle}>Location sharing is OFF</Text>
            <Text style={s.body}>{journey ? 'Your journey is running, but your live location is not shared.' : 'Nobody can see where you are right now.'}</Text>
          </View>
        </Card>
      )}

      {/* Active sharing sessions */}
      <SectionHeader title="Active sharing sessions" />
      {!loading && !journey && !sos ? (
        <Card tone="flat">
          <Text style={s.body}>No active sessions. Journeys and emergencies you share will appear here while they are running.</Text>
        </Card>
      ) : null}
      {journey && (
        <Card style={{ gap: 12, marginBottom: 12 }}>
          <View style={s.between}>
            <View style={{ flex: 1 }}>
              <Overline>Journey</Overline>
              <Text style={s.sessionTitle} numberOfLines={1}>To {journey.destination_name}</Text>
            </View>
            <Badge label={sharing ? 'Shared live' : 'Not shared'} tone={sharing ? 'green' : 'neutral'} dot={sharing} caps={false} />
          </View>
          {sharing && viewers.length > 0 ? (
            <View>
              {viewers.map((v, i) => (
                <View key={`${v.recipient_id}-${i}`} style={[s.viewer, i < viewers.length - 1 && s.line]}>
                  <Avatar name={v.recipient_name} px={34} tone="green" />
                  <Text style={s.viewerName} numberOfLines={1}>{v.recipient_name}</Text>
                  <Button title="Remove" small variant="secondary" full={false} disabled={!v.recipient_id} onPress={() => setViewerToRemove(v)} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.body}>{recipients.length ? 'Nobody can watch this journey live. People you chose are only notified.' : 'Nobody was chosen for this journey.'}</Text>
          )}
          <View style={s.row}>
            {sharing && <Button title="Stop sharing" icon="eyeOff" variant="secondary" small style={{ flex: 1 }} onPress={() => setConfirm('stopAll')} />}
            <Button title="Open journey" icon="journey" variant="secondary" small style={{ flex: 1 }} onPress={() => router.push({ pathname: '/journey', params: { id: journey.id } })} />
          </View>
        </Card>
      )}
      {sos && (
        <Card tone="emergency" style={{ gap: 10, marginBottom: 12 }}>
          <View style={s.between}>
            <View style={{ flex: 1 }}>
              <Overline color={colors.emergency}>Emergency</Overline>
              <Text style={s.sessionTitle}>SOS active</Text>
            </View>
            <Badge label={`${sos.count} ${sos.count === 1 ? 'contact' : 'contacts'}`} tone="orange" caps={false} dot />
          </View>
          <Text style={s.body}>Your emergency contacts can see your location. Resolve the emergency to stop sharing it.</Text>
          <Button title="Open SOS" icon="sos" variant="danger" small onPress={() => router.push('/sos')} />
        </Card>
      )}
      <Card style={s.list}>
        <ListRow icon="radar" title="People sharing with me" subtitle="Journeys and alerts others shared with you" onPress={() => router.push('/shared')} last />
      </Card>

      {/* Location sharing */}
      <SectionHeader title="Location sharing" />
      <Card style={s.list}>
        <ToggleRow
          icon="radar"
          title="Share live location by default"
          subtitle="Start Journey begins with live sharing on. You can switch it off each time."
          value={prefs.defaultLiveShare}
          onValueChange={(v) => update({ defaultLiveShare: v })}
        />
        <ListRow icon="groups" title="Who can see my journeys" subtitle={recipientSummary} onPress={() => router.push('/privacy-recipients')} />
        <ListRow
          icon="lock"
          tone="green"
          title="Stops when you arrive"
          subtitle="Sharing always ends when you arrive or cancel."
          right={<Badge label="Always on" tone="green" caps={false} />}
          last
        />
      </Card>

      {/* Journey notifications */}
      <SectionHeader title="Journey notifications" />
      <Card style={s.list}>
        <ListRow
          icon="bell"
          title="Alerts I receive"
          subtitle={prefs.journeyUpdates ? `${alertTypes} of 4 update types on` : 'Journey updates are off'}
          onPress={() => router.push('/notification-settings')}
          last
        />
      </Card>

      {/* Emergency sharing */}
      <SectionHeader title="Emergency sharing" />
      <Card style={s.list}>
        <ToggleRow
          icon="sos"
          tone="orange"
          title="Live location during SOS"
          subtitle="Keep sending your location to emergency contacts while an SOS is active. If off, only your first location is sent."
          value={prefs.sosShareLive}
          onValueChange={(v) => update({ sosShareLive: v })}
        />
        <View style={s.block}>
          <Text style={s.rowTitle}>Cancel countdown</Text>
          <Text style={s.body}>Time you have to cancel a false alarm before the SOS is sent.</Text>
          <View style={s.chips}>
            {COUNTDOWNS.map((c) => (
              <Chip key={c} label={`${c} seconds`} selected={prefs.sosCountdown === c} onPress={() => update({ sosCountdown: c })} />
            ))}
          </View>
        </View>
        <ListRow icon="call" tone="orange" title="Emergency contacts" subtitle="Who receives your SOS" onPress={() => router.push('/emergency-contacts')} last />
      </Card>

      {/* Permissions */}
      <SectionHeader title="Location permissions" />
      <Card style={{ gap: 12 }}>
        <View style={s.row}>
          <IconTile icon={perm.status === 'granted' ? 'locate' : 'locationOff'} tone={perm.status === 'granted' ? 'green' : 'amber'} px={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>While using the app</Text>
            <Text style={s.body}>Needed to track a journey and detect arrival.</Text>
          </View>
          <Badge label={perm.status === 'granted' ? 'Allowed' : perm.status === 'denied' ? 'Blocked' : 'Not asked'} tone={perm.status === 'granted' ? 'green' : 'amber'} caps={false} />
        </View>
        {perm.status === 'granted' && perm.precise === false && (
          <View style={s.note}>
            <Icon name="warning" size={16} color={colors.warning} />
            <Text style={[s.body, { flex: 1, color: colors.warning }]}>Only approximate location is allowed. Arrival detection may be unreliable. Allow precise location in phone settings.</Text>
          </View>
        )}
        <View style={s.note}>
          <Icon name="info" size={16} color={colors.dim} />
          <Text style={[s.body, { flex: 1 }]}>Location is sent only while a journey screen is open. Background location is not used.</Text>
        </View>
        <View style={s.row}>
          {perm.status !== 'granted' && <Button title={perm.status === 'denied' && !perm.canAsk ? 'Allow in settings' : 'Allow location'} icon="locate" small style={{ flex: 1 }} onPress={askPermission} />}
          <Button title="Phone settings" icon="settings" variant="secondary" small style={{ flex: 1 }} onPress={() => Linking.openSettings()} />
        </View>
      </Card>

      {/* Retention */}
      <SectionHeader title="Location data retention" />
      <Card style={{ gap: 12 }}>
        <Text style={s.body}>Choose how long Arrive Notify keeps the GPS points recorded during your journeys.</Text>
        <View style={s.chips}>
          {RETENTION.map((r) => (
            <Chip key={r.v} label={r.label} selected={prefs.retentionDays === r.v} onPress={() => update({ retentionDays: r.v })} />
          ))}
        </View>
        <Text style={s.body}>
          {retentionText} Old points are removed automatically about once a day when you open the app. Journey summaries in History are not affected.
        </Text>
        <Button title="Delete my location history now" icon="trash" variant="secondary" onPress={() => setConfirm('clear')} />
      </Card>

      {/* Personal data */}
      <SectionHeader title="Personal data & account" />
      <Card style={s.list}>
        <ListRow icon="shield" title="Your data and account" subtitle="Download, delete history, delete account" onPress={() => router.push('/privacy-data')} last />
      </Card>

      <ConfirmModal
        visible={confirm === 'stopAll'}
        tone="danger"
        title="Stop sharing your location?"
        message="The people watching your journey will no longer see where you are. Your journey keeps running. An active SOS is not affected."
        confirmLabel="Stop sharing"
        busy={busy}
        onConfirm={stopAllSharing}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        visible={confirm === 'clear'}
        tone="danger"
        title="Delete location history?"
        message="All saved GPS points from your finished journeys are deleted. Journey summaries stay in History. This cannot be undone."
        confirmLabel="Delete"
        busy={busy}
        onConfirm={clearHistory}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        visible={!!viewerToRemove}
        tone="danger"
        title="Remove from this journey?"
        message={`${viewerToRemove?.recipient_name ?? 'This person'} will stop seeing your live location for this journey.`}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={removeViewer}
        onCancel={() => setViewerToRemove(null)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  list: { paddingVertical: 4, paddingHorizontal: 14 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  bannerText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 17 },
  liveTitle: { ...type.h3 },
  sessionTitle: { ...type.h2, marginTop: 2 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  body: { color: colors.mute, fontSize: 13, lineHeight: 19 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  block: { paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  viewer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  viewerName: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '700' },
});
