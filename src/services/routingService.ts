import type { LatLng } from '../lib/geo';
import type { RouteInfo } from '../lib/types';
import { fail, ok, ServiceResult } from './result';

// Provider choice (set in .env, then restart with: npx expo start -c)
//   EXPO_PUBLIC_MAPBOX_TOKEN=...   -> Mapbox Directions (traffic-aware). Recommended.
//   (nothing set)                  -> the free public OSRM demo server: no key, car routes,
//                                     no traffic, "reasonable non-commercial use", 1 request/second max.
//   EXPO_PUBLIC_OSRM_URL=...       -> your own OSRM server
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const OSRM_BASE = process.env.EXPO_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org';

export const routingProvider: 'mapbox' | 'osrm' = MAPBOX_TOKEN ? 'mapbox' : 'osrm';
export const routingAttribution =
  routingProvider === 'mapbox' ? 'Routes by Mapbox. Map data \u00A9 OpenStreetMap contributors' : 'Routes by OSRM. Map data \u00A9 OpenStreetMap contributors';

// Decodes an encoded polyline (precision 5) into map points
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = Math.pow(10, precision);
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / factor, longitude: lng / factor });
  }
  return points;
}

const validPoint = (p: LatLng) =>
  Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

// Asks the routing provider for the driving route and travel time. If it cannot
// answer, an error is returned. A time is never guessed or invented.
export async function getRoute(from: LatLng, to: LatLng): Promise<ServiceResult<RouteInfo>> {
  if (!validPoint(from) || !validPoint(to)) return fail('INVALID_COORDINATES', 'The route needs two valid locations.');

  const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  const url =
    routingProvider === 'mapbox'
      ? `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?overview=full&geometries=polyline&access_token=${encodeURIComponent(MAPBOX_TOKEN as string)}`
      : `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=polyline&alternatives=false&steps=false`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'ArriveNotify/1.0 (college microproject)' },
    });
    if (res.status === 429) return fail('ROUTING_RATE_LIMITED', 'The routing service is busy. The estimate will refresh shortly.');
    const data: any = await res.json().catch(() => null);
    if (!data) return fail('ROUTING_UNAVAILABLE', 'The routing service sent an unreadable answer.');
    if (data.code === 'NoRoute') return fail('NO_ROUTE', 'No road route was found between you and the destination.');
    const r = data.routes?.[0];
    if (data.code !== 'Ok' || !r) return fail('ROUTING_UNAVAILABLE', `The routing service could not calculate a route${data.code ? ` (${data.code})` : ''}.`);
    if (!Number.isFinite(r.distance) || !Number.isFinite(r.duration) || typeof r.geometry !== 'string') {
      return fail('ROUTING_UNAVAILABLE', 'The routing service answer was incomplete.');
    }
    const points = decodePolyline(r.geometry);
    if (points.length < 2) return fail('ROUTING_UNAVAILABLE', 'The routing service returned an empty route.');
    return ok({ distance_m: r.distance, duration_s: r.duration, polyline: r.geometry, points, provider: routingProvider });
  } catch (e: any) {
    if (e?.name === 'AbortError') return fail('ROUTING_TIMEOUT', 'The routing service took too long to answer.');
    return fail('NETWORK_ERROR', 'No connection to the routing service.');
  } finally {
    clearTimeout(timer);
  }
}
