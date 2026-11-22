import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, Linking, Share, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/prefs';
import { Avatar, Badge, Button, Card, ConfirmModal, Icon, IconTile, Input, Overline, PulseDot, Screen, ScreenHeader, SectionHeader } from '../components/ui';
import { fmtTime } from '../lib/format';
import { colors, radius, type } from '../lib/theme';
import { EMERGENCY_NUMBER, SOS_COUNTDOWN_SECONDS, SOS_LOCATION_UPLOAD_MS, googleMapsUrl } from '../lib/sos';
import {
  getActiveSos, getLatestLocation, getMyEmergencyContacts, resolveSos, sendSos, sosShareMessage, updateSosLocation,
} from '../services/sosService';
import { subscribeToSosResponses } from '../services/realtimeService';
import type { EmergencyContact, SosAlert, SosRecipient } from '../lib/types';

type Phase = 'loading' | 'idle' | 'countdown' | 'sending' | 'active' | 'resolved';

function callEmergency() {
  Linking.openURL(`tel:${EMERGENCY_NUMBER}`).catch(() =>
    Alert.alert('Could not start the call', `Please dial ${EMERGENCY_NUMBER} on your phone.`)
  );
}

export default function Sos() {
  const router = useRouter();
  const { session } = useAuth();
  const { journeyId } = useLocalSearchParams<{ journeyId?: string }>();
  const name = session?.user.user_metadata?.name as string | undefined;

  const [phase, setPhase] = useState<Phase>('loading');
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const { prefs } = usePrefs();
  const [count, setCount] = useState(SOS_COUNTDOWN_SECONDS);
  // Privacy Settings: should automatic location updates keep going during an SOS?
  const shareLiveRef = useRef(prefs.sosShareLive);
  useEffect(() => {
    shareLiveRef.current = prefs.sosShareLive;
  }, [prefs.sosShareLive]);
  const [sos, setSos] = useState<SosAlert | null>(null);
  const [recipients, setRecipients] = useState<SosRecipient[]>([]);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [lastLoc, setLastLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [resolving, setResolving] = useState(false);
  const [confirmRes, setConfirmRes] = useState(false);
  const [updating, setUpdating] = useState(false);
  const lastUpload = useRef(0);

  const accepted = contacts.filter((c) => c.status === 'accepted');

  const refreshActive = useCallback(async () => {
    const a = await getActiveSos();
    if (!a.ok) return;
    if (a.data.alert) {
      setSos(a.data.alert);
      setRecipients(a.data.recipients);
      if (a.data.alert.latitude != null && a.data.alert.longitude != null) {
        setLastLoc({ latitude: a.data.alert.latitude, longitude: a.data.alert.longitude });
      }
    } else {
      setSos(null);
      setPhase((p) => (p === 'active' ? 'resolved' : p));
    }
  }, []);

  const loadAll = useCallback(async () => {
    const [a, c] = await Promise.all([getActiveSos(), getMyEmergencyContacts()]);
    if (c.ok) {
      setContacts(c.data);
      setSelected((prev) => (prev.length ? prev : c.data.filter((x) => x.status === 'accepted').map((x) => x.contact_user_id)));
    }
    if (a.ok && a.data.alert) {
      setSos(a.data.alert);
      setRecipients(a.data.recipients);
      setPhase('active');
    } else {
      setPhase('idle');
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // 5-second countdown so a false alarm can be cancelled
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      send();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count]);

  // While the SOS is active, keep the latest location fresh (foreground only)
  useEffect(() => {
    if (phase !== 'active' || !sos) return;
    const alertId = sos.id;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setGpsDenied(true);
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (pos) => {
          setLastLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          if (!shareLiveRef.current) return; // live updates are switched off in Privacy Settings
          const t = Date.now();
          if (t - lastUpload.current < SOS_LOCATION_UPLOAD_MS) return;
          lastUpload.current = t;
          updateSosLocation(alertId, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            recordedAt: pos.timestamp,
          }).then((res) => {
            if (res.ok) {
              setOffline(false);
              setLastSentAt(Date.now());
            } else if (res.error.code === 'NETWORK_ERROR') {
              setOffline(true);
            } else if (res.error.code === 'SOS_NOT_ACTIVE') {
              refreshActive();
            }
          });
        }
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [phase, sos?.id]);

  // contacts answering ("seen", "on my way") arrive live; check every 30 s as a backup
  useEffect(() => {
    if (phase !== 'active' || !sos) return;
    const off = subscribeToSosResponses(sos.id, refreshActive);
    const t = setInterval(refreshActive, 30000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [phase, sos?.id]);

  function startCountdown() {
    setFailure(null);
    if (selected.length === 0) {
      setFailure({
        code: 'NO_EMERGENCY_CONTACTS',
        message: accepted.length === 0
          ? 'You have no accepted emergency contacts yet, so nobody could be alerted.'
          : 'Select at least one emergency contact.',
      });
      return;
    }
    setCount(prefs.sosCountdown);
    setPhase('countdown');
  }

  async function send() {
    setPhase('sending');
    setFailure(null);
    const res = await sendSos({ message: note, contactIds: selected, journeyId: journeyId ? String(journeyId) : null });
    if (res.ok) {
      setSos(res.data.alert);
      if (res.data.location) {
        setLastLoc({ latitude: res.data.location.latitude, longitude: res.data.location.longitude });
        setLastSentAt(Date.now());
      }
      setPhase('active');
      refreshActive();
      return;
    }
    if (res.error.code === 'SOS_ALREADY_ACTIVE' && res.error.details?.alert) {
      setSos(res.error.details.alert);
      setPhase('active');
      refreshActive();
      return;
    }
    setFailure({ code: res.error.code, message: res.error.message });
    setPhase('idle');
  }

  async function shareByMessage() {
    const loc = lastLoc ?? (await getLatestLocation());
    await Share.share({ message: sosShareMessage(name, note || sos?.message, loc) });
  }

  async function doResolve() {
    if (!sos) return;
    setResolving(true);
    const res = await resolveSos(sos.id);
    setResolving(false);
    setConfirmRes(false);
    if (!res.ok) {
      Alert.alert('Could not resolve', `${res.error.message}\nYour alert is still active. Try again when you have a connection.`);
      return;
    }
    setSos(null);
    setPhase('resolved');
  }

  // Sends the current position to your contacts right now (in addition to the automatic updates)
  async function updateLocationNow() {
    if (!sos) return;
    setUpdating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setGpsDenied(true);
        return;
      }
      setGpsDenied(false);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLastLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      const res = await updateSosLocation(sos.id, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        recordedAt: pos.timestamp,
      });
      if (res.ok) {
        setOffline(false);
        setLastSentAt(Date.now());
        lastUpload.current = Date.now();
      } else if (res.error.code === 'NETWORK_ERROR') {
        setOffline(true);
      } else {
        Alert.alert('Could not update location', res.error.message);
      }
    } catch {
      Alert.alert('Location unavailable', 'Could not read your GPS position. Try again with a clear view of the sky.');
    } finally {
      setUpdating(false);
    }
  }

  // ---------------- screens ----------------
  if (phase === 'loading') {
    return (
      <Screen>
        <View style={s.center}>
          <PulseDot color={colors.emergency} />
        </View>
      </Screen>
    );
  }

  // Emergency confirmation: 5-second countdown so a false alarm can be cancelled
  if (phase === 'countdown' || phase === 'sending') {
    return (
      <View style={[s.center, { backgroundColor: '#1A0B09' }]}>
        {phase === 'sending' ? (
          <>
            <PulseDot color={colors.emergency} />
            <Text style={s.bigText}>Sending SOS…</Text>
            <Text style={s.light}>Getting your latest location and alerting your emergency contacts.</Text>
          </>
        ) : (
          <>
            <Overline color={colors.emergency}>Emergency</Overline>
            <Text style={s.light}>Sending SOS in</Text>
            <View style={s.countRing}>
              <Text style={s.countdown}>{count}</Text>
            </View>
            <Text style={s.light}>
              {selected.length} {selected.length === 1 ? 'contact' : 'contacts'} will be alerted with your location.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 14 }}>
              <Button title="Cancel (false alarm)" variant="secondary" onPress={() => setPhase('idle')} />
              <Button title="Send now" variant="danger" onPress={send} />
            </View>
          </>
        )}
      </View>
    );
  }

  if (phase === 'resolved') {
    return (
      <Screen footer={<Button title="Done" onPress={() => router.replace('/')} />}>
        <View style={s.center}>
          <View style={[s.ring, { borderColor: colors.success, backgroundColor: colors.successSoft }]}>
            <Icon name="check" size={52} color={colors.success} />
          </View>
          <Text style={[type.display, { marginTop: 8, textAlign: 'center' }]}>Emergency resolved</Text>
          <Text style={[s.sub, { textAlign: 'center', fontSize: 15 }]}>Your contacts were told, and your location is no longer shared.</Text>
        </View>
      </Screen>
    );
  }

  if (phase === 'active' && sos) {
    const locAge = sos.location_updated_at ? Math.round((now - new Date(sos.location_updated_at).getTime()) / 1000) : null;
    const sentAgo = lastSentAt ? Math.max(0, Math.round((now - lastSentAt) / 1000)) : null;
    const sharing = !!lastLoc && !gpsDenied && !offline;
    return (
      <Screen scroll>
        <Card tone="emergency" style={s.activeBar}>
          <View style={s.rowC}>
            <PulseDot color={colors.emergency} />
            <Text style={s.activeBarTitle}>SOS ACTIVE</Text>
          </View>
          <Text style={s.activeBarSub}>Started at {fmtTime(sos.created_at)}. Your emergency contacts were alerted.</Text>
        </Card>

        <SectionHeader title="Location" />
        <Card style={{ gap: 12 }}>
          <View style={s.rowC}>
            <IconTile icon={lastLoc ? 'locate' : 'locationOff'} tone={sharing ? 'green' : 'amber'} px={40} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{lastLoc ? 'Location sharing' : 'Location unknown'}</Text>
              <Text style={s.sub}>
                {lastLoc
                  ? `Latest position shared${sentAgo != null ? ` · sent ${sentAgo} s ago` : locAge != null ? ` · ${locAge} s old` : ''}`
                  : 'No GPS location was available. Tell your contacts where you are.'}
              </Text>
            </View>
            <Badge label={sharing ? 'Live' : offline ? 'Offline' : gpsDenied ? 'GPS off' : 'Last known'} tone={sharing ? 'green' : 'amber'} caps={false} dot />
          </View>
          {!prefs.sosShareLive && <Text style={s.warn}>Automatic location updates are off in Privacy Settings. Tap Update Location to send your position.</Text>}
          {gpsDenied && <Text style={s.warn}>Location permission is off, so your location cannot be updated.</Text>}
          {offline && <Text style={s.warn}>No connection. Location updates will resume when you are online.</Text>}
          <View style={s.rowC}>
            <Button title="Update Location" icon="refresh" variant="secondary" small style={{ flex: 1 }} loading={updating} onPress={updateLocationNow} />
            {lastLoc && (
              <Button
                title="Open in Maps"
                icon="map"
                variant="secondary"
                small
                style={{ flex: 1 }}
                onPress={() => Linking.openURL(googleMapsUrl(lastLoc.latitude, lastLoc.longitude))}
              />
            )}
          </View>
          {!!sos.message && <Text style={s.sub}>Your message: {sos.message}</Text>}
        </Card>

        <SectionHeader title="Emergency contacts" />
        {recipients.length === 0 ? (
          <Text style={s.sub}>Loading…</Text>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {recipients.map((r, i) => (
              <View key={r.recipient_id} style={[s.person, i < recipients.length - 1 && s.personLine]}>
                <Avatar name={r.recipient_name} px={36} tone={r.response === 'on_my_way' ? 'green' : 'blue'} />
                <Text style={s.name} numberOfLines={1}>{r.recipient_name}</Text>
                <Badge
                  label={r.response === 'on_my_way' ? 'On their way' : r.response === 'seen' ? 'Seen' : 'Not seen yet'}
                  tone={r.response === 'on_my_way' ? 'green' : r.response === 'seen' ? 'amber' : 'neutral'}
                  caps={false}
                />
              </View>
            ))}
          </Card>
        )}

        <View style={{ gap: 10, marginTop: 22 }}>
          <Button title={`Call ${EMERGENCY_NUMBER} (emergency services)`} icon="call" variant="danger" onPress={callEmergency} />
          <Button title="Also send by message" icon="send" variant="secondary" onPress={shareByMessage} />
          <Button title="I am safe: Resolve Emergency" icon="shieldCheck" variant="success" disabled={resolving} onPress={() => setConfirmRes(true)} />
        </View>

        <Text style={s.note}>
          Contacts see this alert inside Arrive Notify while their app is open. Push and SMS are not set up yet, so also call or message them. Location updates are sent only while this screen is open.
        </Text>

        <ConfirmModal
          visible={confirmRes}
          title="Mark as resolved?"
          message="Your emergency contacts are told the emergency is resolved, and your location sharing stops."
          confirmLabel="I am safe: resolve"
          cancelLabel="Not yet"
          busy={resolving}
          onConfirm={doResolve}
          onCancel={() => setConfirmRes(false)}
        />
      </Screen>
    );
  }

  // idle: the SOS button
  return (
    <Screen scroll>
      <ScreenHeader title="Emergency SOS" onBack={() => router.back()} />

      <Card tone="emergency" onPress={callEmergency} style={s.callCard}>
        <IconTile icon="call" tone="orange" px={40} />
        <Text style={s.callText}>If you are in danger, call {EMERGENCY_NUMBER} first</Text>
        <Icon name="chevron" size={16} color={colors.emergency} />
      </Card>

      {failure && (
        <Card tone="emergency" style={{ marginTop: 14, gap: 8 }}>
          <Badge label="SOS not sent" tone="orange" icon="warning" />
          <Text style={s.failureText}>{failure.message}</Text>
          <Button title="Send my location by message instead" variant="secondary" small onPress={shareByMessage} />
          {failure.code === 'NO_EMERGENCY_CONTACTS' ? (
            <Button title="Add emergency contacts" variant="secondary" small onPress={() => router.push('/emergency-contacts')} />
          ) : (
            <Button title="Try again" variant="secondary" small onPress={startCountdown} />
          )}
        </Card>
      )}

      <View style={s.sosWrap}>
        <View style={s.halo2}>
          <View style={s.halo1}>
            <Pressable style={s.sosButton} onPress={startCountdown} accessibilityRole="button" accessibilityLabel="Send SOS">
              <Text style={s.sosText}>SOS</Text>
            </Pressable>
          </View>
        </View>
        <Text style={[s.sub, { marginTop: 14 }]}>Tap, then you have {prefs.sosCountdown} seconds to cancel.</Text>
      </View>

      <Input
        placeholder="What is happening? (optional, shared with your contacts)"
        value={note}
        onChangeText={setNote}
        maxLength={200}
        multiline
      />

      <SectionHeader title="Who will be alerted" />
      {accepted.length === 0 ? (
        <Card>
          <Text style={s.sub}>You have no accepted emergency contacts yet. People must accept before they can receive an SOS.</Text>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {accepted.map((c) => {
            const on = selected.includes(c.contact_user_id);
            return (
              <Card
                key={c.id}
                tone={on ? 'emergency' : 'default'}
                style={s.pick}
                onPress={() => setSelected((l) => (on ? l.filter((x) => x !== c.contact_user_id) : [...l, c.contact_user_id]))}
              >
                <Avatar name={c.name} px={40} tone={on ? 'orange' : 'blue'} />
                <Text style={[s.name, { flex: 1 }]}>{c.name}</Text>
                {on ? <Icon name="checkCircle" size={24} color={colors.emergency} /> : <View style={s.tick} />}
              </Card>
            );
          })}
        </View>
      )}
      {contacts.some((c) => c.status === 'pending') && <Text style={[s.sub, { marginTop: 10 }]}>Some people have not accepted yet and will not receive the alert.</Text>}
      <View style={{ height: 12 }} />
      <Button title="Manage emergency contacts" icon="contacts" variant="secondary" onPress={() => router.push('/emergency-contacts')} />

      <Text style={s.note}>
        Your latest GPS location and a Google Maps link are shared with the selected contacts. If GPS is not available, the alert is still sent without a location. Contacts see the alert inside Arrive Notify while their app is open. Push and SMS are not set up yet, so this does not replace calling {EMERGENCY_NUMBER}.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  rowC: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sub: { color: colors.mute, fontSize: 13, lineHeight: 18 },
  note: { color: colors.dim, fontSize: 11, lineHeight: 16, marginTop: 20 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 2 },
  personLine: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line },
  callCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  callText: { flex: 1, color: '#FFD2C7', fontSize: 14, fontWeight: '700' },
  failureText: { color: '#FFE4DD', fontSize: 14, lineHeight: 20 },
  sosWrap: { alignItems: 'center', marginVertical: 26 },
  halo2: { width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(255,112,79,0.08)', alignItems: 'center', justifyContent: 'center' },
  halo1: { width: 214, height: 214, borderRadius: 107, backgroundColor: 'rgba(255,112,79,0.16)', alignItems: 'center', justifyContent: 'center' },
  sosButton: { width: 176, height: 176, borderRadius: 88, backgroundColor: colors.emergency, alignItems: 'center', justifyContent: 'center', shadowColor: colors.emergency, shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 14 },
  sosText: { color: '#1A0A06', fontSize: 50, fontWeight: '900', letterSpacing: 2 },
  bigText: { color: colors.ink, fontSize: 26, fontWeight: '800' },
  light: { color: '#FFD2C7', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  countRing: { width: 210, height: 210, borderRadius: 105, borderWidth: 6, borderColor: colors.emergency, backgroundColor: colors.emergencySoft, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  countdown: { color: colors.ink, fontSize: 96, fontWeight: '900' },
  ring: { width: 116, height: 116, borderRadius: 58, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  activeBar: { gap: 6 },
  activeBarTitle: { color: colors.emergency, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  activeBarSub: { color: '#FFD2C7', fontSize: 13 },
});
