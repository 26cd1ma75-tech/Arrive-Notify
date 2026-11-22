import { supabase } from '../lib/supabase';
import { callRpc, fail, fromSupabaseError, ok, ServiceError, ServiceResult } from './result';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True when the privacy database functions have not been installed yet (privacy-backend.sql not run)
export function isMissingRpc(e: ServiceError | null | undefined): boolean {
  return !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(e.message));
}

// ---------- settings (synced across devices) ----------
export async function getPrivacySettings(): Promise<ServiceResult<{ settings: Record<string, unknown> }>> {
  return callRpc('get_my_privacy_settings', {});
}

export async function updatePrivacySettings(patch: Record<string, unknown>): Promise<ServiceResult<{ settings: Record<string, unknown> }>> {
  return callRpc('update_my_privacy_settings', { p_patch: patch });
}

// ---------- location data retention ----------
export async function applyMyRetention(): Promise<ServiceResult<{ deleted_points: number }>> {
  return callRpc('apply_my_retention', {});
}

export async function clearMyLocationHistory(): Promise<ServiceResult<{ deleted_points: number }>> {
  return callRpc('clear_my_location_history', {});
}

// ---------- who can see a journey ----------
export async function revokeJourneyViewer(journeyId: string, userId: string): Promise<ServiceResult<{ revoked: boolean }>> {
  if (!UUID.test(journeyId) || !UUID.test(userId)) return fail('INVALID_INPUT', 'That person cannot be removed.');
  return callRpc('revoke_journey_viewer', { p_journey_id: journeyId, p_user_id: userId });
}

// ---------- personal data ----------
export type DataSummary = { journeys: number; locationPoints: number; places: number };

// Counts of what is stored about the signed-in user (row level security limits every count to their own rows)
export async function getMyDataSummary(): Promise<ServiceResult<DataSummary>> {
  const head = (table: string) => supabase.from(table).select('id', { count: 'exact', head: true });
  const [j, l, p] = await Promise.all([head('journeys'), head('journey_locations'), head('places')]);
  const err = j.error ?? l.error ?? p.error;
  if (err) {
    const e = fromSupabaseError(err);
    return fail(e.code, e.message);
  }
  return ok({ journeys: j.count ?? 0, locationPoints: l.count ?? 0, places: p.count ?? 0 });
}

export async function exportMyData(): Promise<ServiceResult<{ data: Record<string, unknown> }>> {
  return callRpc('export_my_data', {});
}

export async function deleteMyJourneyHistory(): Promise<ServiceResult<{ deleted_journeys: number }>> {
  return callRpc('delete_my_journey_history', {});
}

export async function deleteMyAccount(): Promise<ServiceResult<Record<string, never>>> {
  return callRpc('delete_my_account', {});
}
