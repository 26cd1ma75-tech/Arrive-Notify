import { supabase } from '../lib/supabase';
import type { AppNotification, LiveJourney } from '../lib/types';

// Every subscription gets its OWN channel name. The Supabase client hands back the existing channel when
// a name is reused, and adding a listener to an already-subscribed channel throws. Screens that stay
// mounted under other screens (the Home tab) would otherwise crash the next screen that listens.
let channelSeq = 0;
const channelName = (base: string) => `${base}-${Date.now().toString(36)}-${(channelSeq++).toString(36)}`;

// Realtime updates of ONE shared journey. Supabase applies the same row level
// security to Realtime, so a person only receives rows they are allowed to read.
// Returns a function that stops listening.
export function subscribeToLiveJourney(
  journeyId: string,
  onChange: (row: LiveJourney) => void,
  onStatus?: (status: string) => void
) {
  const channel = supabase
    .channel(channelName(`live-journey-${journeyId}`))
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'journey_live', filter: `journey_id=eq.${journeyId}` },
      (payload: any) => {
        if (payload?.new && Object.keys(payload.new).length > 0) onChange(payload.new as LiveJourney);
      }
    )
    .subscribe((status: string) => onStatus?.(status));
  return () => {
    supabase.removeChannel(channel);
  };
}

// New notifications addressed to me (shown while the app is open)
export function subscribeToMyNotifications(userId: string, onNew: (n: AppNotification) => void) {
  const channel = supabase
    .channel(channelName(`my-notifications-${userId}`))
    .on(
      'postgres_changes' as any,
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload: any) => {
        if (payload?.new) onNew(payload.new as AppNotification);
      }
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------- Emergency SOS ----------
// Changes of ONE alert (status, latest location). Only the sender and the chosen contacts receive them.
export function subscribeToSosAlert(alertId: string, onChange: (row: any) => void, onStatus?: (s: string) => void) {
  const channel = supabase
    .channel(channelName(`sos-alert-${alertId}`))
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'sos_alerts', filter: `id=eq.${alertId}` },
      (payload: any) => {
        if (payload?.new && Object.keys(payload.new).length > 0) onChange(payload.new);
      }
    )
    .subscribe((status: string) => onStatus?.(status));
  return () => {
    supabase.removeChannel(channel);
  };
}

// The sender sees contacts answer ("seen", "on my way") as it happens
export function subscribeToSosResponses(alertId: string, onChange: () => void) {
  const channel = supabase
    .channel(channelName(`sos-responses-${alertId}`))
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'sos_recipients', filter: `alert_id=eq.${alertId}` },
      () => onChange()
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// Any alert sent to me (list refresh)
export function subscribeToMySosAlerts(onChange: () => void) {
  const channel = supabase
    .channel(channelName('my-sos-alerts'))
    .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'sos_alerts' }, () => onChange())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
