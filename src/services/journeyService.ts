import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import type { Journey } from '../lib/types';
import { callRpc, fail, fromSupabaseError, ok, ServiceResult } from './result';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecipientInput = {
  recipient_id?: string | null;
  recipient_name: string;
  recipient_contact?: string | null;
  notification_enabled?: boolean;
};

export type StartJourneyData = {
  journey: Journey;
  distance_m: number;
  eta_seconds: number | null;            // null: no routing provider connected
  estimated_arrival_at: string | null;   // null: no routing provider connected
  recipients_count: number;              // people who will get an arrival notification record
  pending_members_skipped: number;       // group members who have not accepted yet
  sharing_live: boolean;                 // true only if live sharing is really on
  viewers_count: number;                 // people who can watch this journey
};

// 5. startQuickJourney
//    Steps: validate id -> ask location permission -> read GPS -> one atomic database
//    call that checks ownership, blocks a 2nd active journey and creates the journey.
export async function startQuickJourney(
  placeId: string,
  options: { recipients?: RecipientInput[]; groupIds?: string[]; shareLive?: boolean } = {}
): Promise<ServiceResult<StartJourneyData>> {
  if (!placeId || !UUID.test(placeId)) return fail('INVALID_PLACE', 'Choose a destination first.');

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    return fail(
      'LOCATION_PERMISSION_DENIED',
      'Location permission is needed to start a journey. On your iPhone: Settings, Expo Go, Location, While Using.'
    );
  }
  let pos: Location.LocationObject;
  try {
    pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return fail('LOCATION_UNAVAILABLE', 'Could not read your GPS location. Check that Location Services is on and try again.');
  }

  const res = await callRpc<StartJourneyData>(
    'start_quick_journey',
    {
      p_place_id: placeId,
      p_latitude: pos.coords.latitude,
      p_longitude: pos.coords.longitude,
      p_accuracy: pos.coords.accuracy ?? null,
      p_recipients: options.recipients ?? [],
      p_group_ids: options.groupIds ?? [],
      p_share_live: options.shareLive ?? false,
    }
  );
  if (!res.ok) return res;
  return ok({
    journey: res.data.journey,
    distance_m: res.data.distance_m,
    eta_seconds: res.data.eta_seconds ?? null,
    estimated_arrival_at: res.data.estimated_arrival_at ?? null,
    recipients_count: res.data.recipients_count ?? 0,
    pending_members_skipped: res.data.pending_members_skipped ?? 0,
    sharing_live: res.data.sharing_live ?? false,
    viewers_count: res.data.viewers_count ?? 0,
  });
}

// 6. getActiveJourney: data is null when there is no active journey
export async function getActiveJourney(): Promise<ServiceResult<Journey | null>> {
  const res = await callRpc<{ journey: Journey | null }>('get_active_journey', {});
  if (!res.ok) return res;
  return ok(res.data.journey ?? null);
}

// Read one journey (RLS only returns the user's own)
export async function getJourney(id: string): Promise<ServiceResult<Journey>> {
  if (!id || !UUID.test(id)) return fail('JOURNEY_NOT_FOUND', 'Journey not found.');
  const { data, error } = await supabase.from('journeys').select('*').eq('id', id).maybeSingle();
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  if (!data) return fail('JOURNEY_NOT_FOUND', 'Journey not found.');
  return ok(data as Journey);
}

// 8. cancelJourney: also safe to repeat
export async function cancelJourney(journeyId: string): Promise<ServiceResult<Journey>> {
  const res = await callRpc<{ journey: Journey }>('cancel_journey', { p_journey_id: journeyId });
  if (!res.ok) return res;
  return ok(res.data.journey);
}

// 10. getJourneyHistory: pagination + sorting
export type HistoryOptions = { limit?: number; offset?: number; status?: 'active' | 'arrived' | 'cancelled' | null; sort?: 'asc' | 'desc' };
export type HistoryPage = { items: Journey[]; total: number; limit: number; offset: number };

export async function getJourneyHistory(opts: HistoryOptions = {}): Promise<ServiceResult<HistoryPage>> {
  const res = await callRpc<HistoryPage & { ok: true }>('get_journey_history', {
    p_limit: opts.limit ?? 20,
    p_offset: opts.offset ?? 0,
    p_status: opts.status ?? null,
    p_sort: opts.sort ?? 'desc',
  });
  if (!res.ok) return res;
  return ok({ items: res.data.items ?? [], total: Number(res.data.total ?? 0), limit: res.data.limit, offset: res.data.offset });
}
