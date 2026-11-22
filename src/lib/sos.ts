// Local emergency number the "Call" button dials. CHANGE THIS for your country.
// 112 is the unified emergency number in India and in the European Union.
export const EMERGENCY_NUMBER = '112';

export const SOS_COUNTDOWN_SECONDS = 5;       // time to cancel a false alarm
export const SOS_LOCATION_TIMEOUT_MS = 6000;  // wait this long for a fresh GPS fix, then use the last known one
export const SOS_LOCATION_UPLOAD_MS = 10000;  // while an SOS is active, send the latest location this often
export const SOS_STALE_AFTER_MS = 120000;     // contacts see "outdated" after 2 minutes without an update

// Google Maps URL (documented Maps URLs format)
export const googleMapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
