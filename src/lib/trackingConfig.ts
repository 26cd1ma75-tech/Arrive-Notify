import * as Location from 'expo-location';

// Update frequency presets (change these numbers to tune battery use and accuracy)
export type TrackingMode = 'saver' | 'normal' | 'precise';
export const TRACKING_MODES: Record<
  TrackingMode,
  { label: string; accuracy: Location.Accuracy; timeInterval: number; distanceInterval: number; uploadMinMs: number }
> = {
  saver: { label: 'Battery saver', accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 25, uploadMinMs: 15000 },
  normal: { label: 'Normal', accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5, uploadMinMs: 5000 },
  precise: { label: 'Precise', accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2, uploadMinMs: 3000 },
};

export const MAX_GOOD_ACCURACY_M = 100;   // readings worse than this are "weak GPS"
export const ETA_REFRESH_MS = 60000;      // ask the routing service at most once a minute...
export const ETA_MIN_MOVE_M = 150;        // ...and only after moving this far
export const ETA_FORCE_REFRESH_MS = 180000; // refresh at least every 3 minutes
export const STALE_AFTER_MS = 120000;     // viewers see "outdated" after 2 minutes without an update
