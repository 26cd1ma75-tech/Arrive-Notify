import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { SOS_LOCATION_TIMEOUT_MS, googleMapsUrl } from '../lib/sos';
import type { EmergencyContact, EmergencyRequest, SosAlert, SosRecipient } from '../lib/types';
import { callRpc, fail, fromSupabaseError, ok, ServiceResult } from './result';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------- emergency contacts ----------------
export async function getMyEmergencyContacts(): Promise<ServiceResult<EmergencyContact[]>> {
  const res = await callRpc<{ contacts: EmergencyContact[] }>('get_my_emergency_contacts', {});
  return res.ok ? ok(res.data.contacts ?? []) : res;
}

export async function getEmergencyRequests(): Promise<ServiceResult<EmergencyRequest[]>> {
  const res = await callRpc<{ requests: EmergencyRequest[] }>('get_emergency_requests', {});
  return res.ok ? ok(res.data.requests ?? []) : res;
}

// Ask someone to be an emergency contact. They must accept before they receive any SOS.
export async function requestEmergencyContact(target: { email?: string; userId?: string }) {
  if (!target.email?.trim() && !target.userId) return fail('INVALID_INPUT', 'Enter an email address.');
  return callRpc<{ contact: EmergencyContact }>('request_emergency_contact', {
    p_email: target.email?.trim() || null,
    p_user_id: target.userId ?? null,
  });
}

export async function respondEmergencyRequest(requestId: string, accept: boolean) {
  if (!UUID.test(requestId)) return fail('INVALID_ID', 'Request is not valid.');
  return callRpc<{ status: string }>('respond_emergency_contact', { p_request_id: requestId, p_accept: accept });
}

export async function removeEmergencyContact(contactId: string) {
  if (!UUID.test(contactId)) return fail('INVALID_ID', 'Contact is not valid.');
  return callRpc<{}>('remove_emergency_contact', { p_contact_id: contactId });
}

// ---------------- location for an SOS ----------------
export type SosLocation = { latitude: number; longitude: number; accuracy: number | null; at: number };

// The latest GPS position that is available RIGHT NOW. Never blocks the alert:
// a fresh fix is tried for a few seconds, then the last known position, then nothing.
export async function getLatestLocation(): Promise<SosLocation | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    let granted = perm.status === 'granted';
    if (!granted && perm.canAskAgain) {
      granted = (await Location.requestForegroundPermissionsAsync()).status === 'granted';
    }
    if (!granted) return null;

    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SOS_LOCATION_TIMEOUT_MS)),
    ]);
    if (fresh) {
      return { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude, accuracy: fresh.coords.accuracy ?? null, at: fresh.timestamp };
    }
    const last = await Location.getLastKnownPositionAsync();
    if (last) {
      return { latitude: last.coords.latitude, longitude: last.coords.longitude, accuracy: last.coords.accuracy ?? null, at: last.timestamp };
    }
  } catch {
    // no location: the SOS is still sent
  }
  return null;
}

// ---------------- SOS ----------------
export type SendSosData = { alert: SosAlert; recipients_count: number; has_location: boolean; location: SosLocation | null };

// Send an SOS to the accepted emergency contacts (all, or the chosen ones)
export async function sendSos(options: { message?: string; contactIds?: string[]; journeyId?: string | null } = {}): Promise<ServiceResult<SendSosData>> {
  const message = options.message?.trim() || null;
  if (message && message.length > 200) return fail('INVALID_MESSAGE', 'The message can be up to 200 characters.');
  const location = await getLatestLocation();
  const res = await callRpc<{ alert: SosAlert; recipients_count: number; has_location: boolean }>('send_sos', {
    p_latitude: location?.latitude ?? null,
    p_longitude: location?.longitude ?? null,
    p_accuracy: location?.accuracy ?? null,
    p_location_at: location ? new Date(location.at).toISOString() : null,
    p_message: message,
    p_contact_ids: options.contactIds ?? [],
    p_journey_id: options.journeyId ?? null,
  });
  if (!res.ok) return res;
  return ok({ alert: res.data.alert, recipients_count: res.data.recipients_count, has_location: res.data.has_location, location });
}

export async function updateSosLocation(alertId: string, loc: { latitude: number; longitude: number; accuracy?: number | null; recordedAt?: number }) {
  return callRpc<{ accepted: boolean }>('update_sos_location', {
    p_alert_id: alertId,
    p_latitude: loc.latitude,
    p_longitude: loc.longitude,
    p_accuracy: loc.accuracy ?? null,
    p_recorded_at: new Date(loc.recordedAt ?? Date.now()).toISOString(),
  });
}

// Only the sender can resolve. The location is wiped from the alert.
export async function resolveSos(alertId: string) {
  return callRpc<{ alert: SosAlert; already_resolved: boolean }>('resolve_sos', { p_alert_id: alertId });
}

export async function acknowledgeSos(alertId: string, response: 'seen' | 'on_my_way') {
  return callRpc<{ response: string }>('acknowledge_sos', { p_alert_id: alertId, p_response: response });
}

export async function getActiveSos(): Promise<ServiceResult<{ alert: SosAlert | null; recipients: SosRecipient[] }>> {
  return callRpc('get_active_sos', {});
}

export async function getSosDetails(alertId: string): Promise<ServiceResult<{ alert: SosAlert; is_sender: boolean; recipients: SosRecipient[] }>> {
  if (!UUID.test(alertId)) return fail('SOS_NOT_FOUND', 'Emergency not found.');
  return callRpc('get_sos_details', { p_alert_id: alertId });
}

// Alerts that other people sent TO ME (row level security returns only mine)
export async function getSosAlertsForMe(): Promise<ServiceResult<SosAlert[]>> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) return fail('UNAUTHENTICATED', 'Please log in again.');
  const { data, error } = await supabase
    .from('sos_alerts')
    .select('*')
    .contains('viewer_ids', [uid])
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  const dayAgo = Date.now() - 86400000;
  const rows = ((data ?? []) as SosAlert[]).filter(
    (a) => (a.status === 'active' && new Date(a.expires_at).getTime() > Date.now()) || new Date(a.created_at).getTime() > dayAgo
  );
  return ok(rows);
}

// Text for the phone's share sheet (WhatsApp, SMS...). Works even when the app cannot reach the server.
export function sosShareMessage(name: string | undefined, note: string | null | undefined, loc: { latitude: number; longitude: number } | null) {
  return (
    `EMERGENCY: ${name ?? 'I'} need${name ? 's' : ''} help.` +
    (note ? ` Message: "${note}".` : '') +
    (loc ? ` My location: ${googleMapsUrl(loc.latitude, loc.longitude)}` : ' My location is not available.')
  );
}
