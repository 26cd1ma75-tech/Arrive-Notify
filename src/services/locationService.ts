import type { Journey } from '../lib/types';
import { callRpc, fail, ServiceResult } from './result';

export type LocationReading = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  recordedAt?: number | Date; // when the GPS fix was taken
};

export type LocationUpdateData = {
  accepted: boolean;
  stored: boolean;
  counted_for_arrival: boolean;
  distance_m: number;
  status: 'active' | 'arrived' | 'cancelled';
  arrived: boolean;
  newly_arrived: boolean;
  eta_seconds: number | null;
  estimated_arrival_at: string | null;
  journey: Journey;
};

// 7. updateJourneyLocation: one GPS reading. The server validates it, stores it
//    sparingly, and decides about arrival.
export async function updateJourneyLocation(
  journeyId: string,
  reading: LocationReading
): Promise<ServiceResult<LocationUpdateData>> {
  if (!isFinite(reading.latitude) || !isFinite(reading.longitude)) {
    return fail('INVALID_COORDINATES', 'Latitude or longitude is not valid.');
  }
  return callRpc<LocationUpdateData>('update_journey_location', {
    p_journey_id: journeyId,
    p_latitude: reading.latitude,
    p_longitude: reading.longitude,
    p_accuracy: reading.accuracy ?? null,
    p_recorded_at: new Date(reading.recordedAt ?? Date.now()).toISOString(),
  });
}

// Poor connectivity: readings that could not be sent are kept in a short queue
// (newest 20) and sent in order as soon as the connection returns.
type Queued = { journeyId: string; reading: LocationReading };
let queue: Queued[] = [];
let flushing: Promise<ServiceResult<LocationUpdateData> | null> | null = null;

async function flush(): Promise<ServiceResult<LocationUpdateData> | null> {
  let last: ServiceResult<LocationUpdateData> | null = null;
  while (queue.length > 0) {
    const item = queue[0];
    const res = await updateJourneyLocation(item.journeyId, item.reading);
    last = res;
    if (res.ok) {
      queue.shift();
      if (res.data.status !== 'active') queue = [];
      continue;
    }
    if (res.error.code === 'NETWORK_ERROR') break; // keep it, try again with the next reading
    queue.shift(); // the server refused this reading (old, invalid...): drop it
    if (['JOURNEY_NOT_ACTIVE', 'JOURNEY_NOT_FOUND', 'UNAUTHENTICATED'].includes(res.error.code)) {
      queue = [];
      break;
    }
  }
  return last;
}

export function sendJourneyLocation(journeyId: string, reading: LocationReading) {
  queue.push({ journeyId, reading });
  if (queue.length > 20) queue = queue.slice(-20);
  if (!flushing) {
    flushing = flush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

export function clearLocationQueue() {
  queue = [];
}

export async function getLatestJourneyLocation(journeyId: string) {
  return callRpc<{ location: { latitude: number; longitude: number; accuracy: number | null; recorded_at: string } | null }>(
    'get_latest_journey_location',
    { p_journey_id: journeyId }
  );
}

// ETA integration point: no routing provider is configured, so the server returns
// null for eta_seconds and estimated_arrival_at. Never estimate travel time from
// straight-line distance.
