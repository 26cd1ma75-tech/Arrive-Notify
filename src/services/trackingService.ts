import { supabase } from '../lib/supabase';
import type { JourneyRecipient, LiveJourney } from '../lib/types';
import { callRpc, fail, fromSupabaseError, ok, ServiceResult } from './result';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Save the route-based ETA that the routing provider returned (traveller only)
export async function updateJourneyRoute(
  journeyId: string,
  data: { eta_seconds: number | null; route_distance_m: number | null; polyline?: string | null; provider?: string | null }
): Promise<ServiceResult<{ eta_seconds: number | null; estimated_arrival_at: string | null; route_distance_m: number | null }>> {
  return callRpc('update_journey_route', {
    p_journey_id: journeyId,
    p_eta_seconds: data.eta_seconds,
    p_route_distance_m: data.route_distance_m,
    p_polyline: data.polyline ?? null,
    p_provider: data.provider ?? null,
  });
}

// Stop or resume sharing the live location during a journey
export async function setJourneySharing(journeyId: string, enabled: boolean): Promise<ServiceResult<{ sharing: boolean }>> {
  return callRpc('set_journey_sharing', { p_journey_id: journeyId, p_enabled: enabled });
}

// Who was chosen for this journey (the traveller can read their own list)
export async function getJourneyRecipients(journeyId: string): Promise<ServiceResult<JourneyRecipient[]>> {
  const { data, error } = await supabase
    .from('journey_recipients')
    .select('recipient_id,recipient_name,notification_enabled,can_track')
    .eq('journey_id', journeyId);
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  return ok((data ?? []) as JourneyRecipient[]);
}

// Journeys other people have shared with ME (row level security returns only mine)
export async function getSharedJourneys(): Promise<ServiceResult<LiveJourney[]>> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) return fail('UNAUTHENTICATED', 'Please log in again.');
  const { data, error } = await supabase
    .from('journey_live')
    .select('*')
    .contains('viewer_ids', [uid])
    .order('started_at', { ascending: false })
    .limit(50);
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  const hourAgo = Date.now() - 3600000;
  const rows = ((data ?? []) as LiveJourney[]).filter(
    (r) => r.status === 'active' || r.status === 'sharing_stopped' || new Date(r.updated_at).getTime() > hourAgo
  );
  return ok(rows);
}

export async function getSharedJourney(journeyId: string): Promise<ServiceResult<LiveJourney>> {
  if (!UUID.test(journeyId)) return fail('JOURNEY_NOT_FOUND', 'This journey is not shared with you.');
  const { data, error } = await supabase.from('journey_live').select('*').eq('journey_id', journeyId).maybeSingle();
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  if (!data) return fail('JOURNEY_NOT_FOUND', 'This journey is not shared with you, or it has ended.');
  return ok(data as LiveJourney);
}

// The route line (fetched separately because it is large)
export async function getSharedRoute(journeyId: string): Promise<ServiceResult<{ polyline: string | null; route_version: number }>> {
  return callRpc('get_shared_journey_route', { p_journey_id: journeyId });
}
