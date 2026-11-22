import * as Location from 'expo-location';
import type { Journey } from '../lib/types';
import { callRpc, fail, ServiceResult } from './result';

// Quick check used by the screen for display only. The SERVER decides real arrival.
export function checkArrival(distanceM: number, radiusM: number, accuracyM?: number | null) {
  const reliable = accuracyM == null || accuracyM <= 100;
  return { inside: distanceM <= radiusM, reliable };
}

// 9. completeJourney / processArrival: marks the journey ARRIVED on the server.
//    The server re-checks the position, so it cannot be faked from the app, and
//    repeating the call is harmless.
export async function processArrival(
  journeyId: string
): Promise<ServiceResult<{ journey: Journey; newly_arrived: boolean; already_arrived?: boolean }>> {
  let pos: Location.LocationObject;
  try {
    pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    return fail('LOCATION_UNAVAILABLE', 'Could not read your GPS location.');
  }
  return callRpc('complete_journey', {
    p_journey_id: journeyId,
    p_latitude: pos.coords.latitude,
    p_longitude: pos.coords.longitude,
    p_accuracy: pos.coords.accuracy ?? null,
  });
}

