import { supabase } from '../lib/supabase';

export type ServiceError = { code: string; message: string; details?: any };
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
export const fail = (code: string, message: string, details?: any): ServiceResult<never> => ({
  ok: false,
  error: { code, message, details },
});

// Turns a Supabase/PostgREST/network error into one consistent error shape
export function fromSupabaseError(e: { code?: string; message?: string } | null | undefined): ServiceError {
  const message = e?.message ?? 'Something went wrong.';
  if (!e?.code && /network|fetch|hostname|internet|offline|timed? ?out|connection/i.test(message)) {
    return { code: 'NETWORK_ERROR', message: 'No connection to the server. Check your internet and try again.' };
  }
  if (e?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return { code: 'UNAUTHORIZED', message: 'You are not allowed to do that.' };
  }
  if (e?.code === 'PGRST116') return { code: 'NOT_FOUND', message: 'Not found.' };
  if (e?.code === '23514') return { code: 'INVALID_INPUT', message: 'Some of the values are not valid.' };
  return { code: e?.code ?? 'DATABASE_ERROR', message };
}

// Calls a database function and unwraps its {ok, error} envelope
export async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<ServiceResult<T>> {
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      const e = fromSupabaseError(error);
      return fail(e.code, e.message);
    }
    if (!data || typeof data !== 'object') return fail('BAD_RESPONSE', 'The server sent an unexpected response.');
    if ((data as any).ok === false) {
      const err = (data as any).error ?? {};
      return fail(err.code ?? 'ERROR', err.message ?? 'The request failed.', err);
    }
    return ok(data as T);
  } catch (e: any) {
    const err = fromSupabaseError(e);
    return fail(err.code, err.message);
  }
}
