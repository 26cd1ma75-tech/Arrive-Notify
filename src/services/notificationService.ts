import { supabase } from '../lib/supabase';
import type { AppNotification } from '../lib/types';
import { fail, fromSupabaseError, ok, ServiceResult } from './result';

// createArrivalNotification is intentionally NOT in the app. Arrival notifications
// are created inside the database (function qa_process_arrival) at the moment the
// server confirms arrival, so they cannot be forged or duplicated.
//
// They are saved with status "pending". Delivering them (push, SMS, link) is the
// next stage: connect a delivery service (for example an Edge Function triggered by
// new rows in "notifications") that sends and then marks them "sent".

// getNotificationHistory: notifications you caused, plus notifications addressed to you
export async function getNotificationHistory(limit = 30): Promise<ServiceResult<AppNotification[]>> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) {
    const e = fromSupabaseError(error);
    return fail(e.code, e.message);
  }
  return ok((data ?? []) as AppNotification[]);
}
