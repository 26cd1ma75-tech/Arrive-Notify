import { supabase } from '../lib/supabase';
import { CATEGORIES, CategoryKey } from '../lib/categories';
import type { Place } from '../lib/types';
import { fail, fromSupabaseError, ok, ServiceResult } from './result';

const COLUMNS =
  'id,name,category,address,latitude,longitude,arrival_radius,is_favorite,created_at,updated_at';

export type PlaceInput = {
  name: string;
  category: CategoryKey;
  address?: string | null;
  latitude: number;
  longitude: number;
  arrival_radius?: number;
  is_favorite?: boolean;
};

// Same rules as the database CHECK constraints, so users get friendly messages
function validate(p: Partial<PlaceInput>, requireAll: boolean) {
  if (requireAll || p.name !== undefined) {
    const n = (p.name ?? '').trim();
    if (n.length < 1 || n.length > 80) return fail('INVALID_NAME', 'Place name is required (up to 80 characters).');
  }
  if (requireAll || p.category !== undefined) {
    if (!CATEGORIES.some((c) => c.key === p.category)) return fail('INVALID_CATEGORY', 'Choose a valid category.');
  }
  if (requireAll || p.latitude !== undefined) {
    if (typeof p.latitude !== 'number' || !isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90)
      return fail('INVALID_COORDINATES', 'Latitude must be between -90 and 90.');
  }
  if (requireAll || p.longitude !== undefined) {
    if (typeof p.longitude !== 'number' || !isFinite(p.longitude) || p.longitude < -180 || p.longitude > 180)
      return fail('INVALID_COORDINATES', 'Longitude must be between -180 and 180.');
  }
  if (p.arrival_radius !== undefined) {
    if (!Number.isInteger(p.arrival_radius) || p.arrival_radius < 50 || p.arrival_radius > 5000)
      return fail('INVALID_RADIUS', 'Arrival radius must be between 50 and 5000 metres.');
  }
  return null;
}

async function signedIn() {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

// 1. getSavedPlaces: only this user's places (also enforced by RLS)
export async function getSavedPlaces(): Promise<ServiceResult<Place[]>> {
  if (!(await signedIn())) return fail('UNAUTHENTICATED', 'Please log in again.');
  const { data, error } = await supabase
    .from('places')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  return ok((data ?? []) as Place[]);
}

// 2. addSavedPlace
export async function addSavedPlace(input: PlaceInput): Promise<ServiceResult<Place>> {
  if (!(await signedIn())) return fail('UNAUTHENTICATED', 'Please log in again.');
  const bad = validate(input, true);
  if (bad) return bad;
  const { data, error } = await supabase
    .from('places')
    .insert({
      name: input.name.trim(),
      category: input.category,
      address: input.address?.trim() || null,
      latitude: input.latitude,
      longitude: input.longitude,
      arrival_radius: input.arrival_radius ?? 500,
      is_favorite: input.is_favorite ?? false,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  return ok(data as Place);
}

// 3. updateSavedPlace: RLS guarantees only the owner can change a place
export async function updateSavedPlace(id: string, patch: Partial<PlaceInput>): Promise<ServiceResult<Place>> {
  if (!(await signedIn())) return fail('UNAUTHENTICATED', 'Please log in again.');
  const bad = validate(patch, false);
  if (bad) return bad;
  const clean: Record<string, unknown> = { ...patch };
  if (typeof patch.name === 'string') clean.name = patch.name.trim();
  if (patch.address !== undefined) clean.address = patch.address?.trim() || null;
  const { data, error } = await supabase.from('places').update(clean).eq('id', id).select(COLUMNS).single();
  if (error) {
    const e = fromSupabaseError(error);
    return e.code === 'NOT_FOUND' ? fail('PLACE_NOT_FOUND', 'That place was not found.') : fail(e.code, e.message);
  }
  return ok(data as Place);
}

// 4. deleteSavedPlace: journey history is kept, because each journey stores its own
//    copy of the destination and the link is set to NULL by the database.
export async function deleteSavedPlace(id: string): Promise<ServiceResult<true>> {
  if (!(await signedIn())) return fail('UNAUTHENTICATED', 'Please log in again.');
  const { data, error } = await supabase.from('places').delete().eq('id', id).select('id');
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  if (!data || data.length === 0) return fail('PLACE_NOT_FOUND', 'That place was not found.');
  return ok(true);
}
