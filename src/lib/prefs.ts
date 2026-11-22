import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './auth';
import { applyMyRetention, getPrivacySettings, isMissingRpc, updatePrivacySettings } from '../services/privacyService';

export type RetentionDays = 0 | 1 | 7 | 30; // 0 = delete GPS points as soon as the journey ends
export type SosCountdown = 3 | 5 | 10;

// Smart Privacy Settings. Stored on the phone and synced to Supabase (privacy_settings table).
export type Prefs = {
  // sharing defaults
  defaultLiveShare: boolean; // Start Journey begins with live sharing switched on
  defaultGroupIds: string[]; // groups pre-selected in Start Journey
  defaultPersonIds: string[]; // people (user ids) pre-selected in Start Journey
  // alerts I receive inside the app
  journeyUpdates: boolean; // master switch for non-emergency alerts
  notifyStarted: boolean;
  notifyNearby: boolean;
  notifyArrived: boolean;
  notifyCancelled: boolean;
  // emergency
  sosShareLive: boolean; // keep sending my location while an SOS is active
  sosCountdown: SosCountdown; // seconds to cancel a false alarm
  // data
  retentionDays: RetentionDays;
};

export const DEFAULT_PREFS: Prefs = {
  defaultLiveShare: false,
  defaultGroupIds: [],
  defaultPersonIds: [],
  journeyUpdates: true,
  notifyStarted: true,
  notifyNearby: true,
  notifyArrived: true,
  notifyCancelled: true,
  sosShareLive: true,
  sosCountdown: 5,
  retentionDays: 7,
};

// Only accept values of the right type, so a corrupted or old copy can never break the app
function sanitize(raw: unknown): Partial<Prefs> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Partial<Prefs> = {};
  const bool = (k: keyof Prefs) => { if (typeof r[k] === 'boolean') (out as any)[k] = r[k]; };
  const ids = (k: 'defaultGroupIds' | 'defaultPersonIds') => {
    if (Array.isArray(r[k])) out[k] = (r[k] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 100);
  };
  (['defaultLiveShare', 'journeyUpdates', 'notifyStarted', 'notifyNearby', 'notifyArrived', 'notifyCancelled', 'sosShareLive'] as const).forEach(bool);
  ids('defaultGroupIds');
  ids('defaultPersonIds');
  if (r.sosCountdown === 3 || r.sosCountdown === 5 || r.sosCountdown === 10) out.sosCountdown = r.sosCountdown;
  if (r.retentionDays === 0 || r.retentionDays === 1 || r.retentionDays === 7 || r.retentionDays === 30) out.retentionDays = r.retentionDays;
  return out;
}

export type SyncState = 'loading' | 'synced' | 'local-only' | 'needs-setup';
type Store = { uid: string | null; prefs: Prefs; ready: boolean; sync: SyncState };

let store: Store = { uid: null, prefs: DEFAULT_PREFS, ready: false, sync: 'loading' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => store;
function setStore(patch: Partial<Store>) {
  store = { ...store, ...patch };
  emit();
}

const localKey = (uid: string) => `arrive-notify.prefs.v2.${uid}`;
const RETENTION_KEY = (uid: string) => `arrive-notify.retention-run.${uid}`;
const ONE_DAY = 24 * 60 * 60 * 1000;

async function persistLocal(uid: string, p: Prefs) {
  try {
    await AsyncStorage.setItem(localKey(uid), JSON.stringify(p));
  } catch {
    // the server copy still exists; ignore device storage errors
  }
}

// Deletes old GPS points according to MY retention choice, at most once a day per device
async function enforceRetention(uid: string) {
  try {
    const last = Number((await AsyncStorage.getItem(RETENTION_KEY(uid))) ?? 0);
    if (Date.now() - last < ONE_DAY) return;
    const res = await applyMyRetention();
    if (res.ok) await AsyncStorage.setItem(RETENTION_KEY(uid), String(Date.now()));
  } catch {
    // retried next time
  }
}

async function loadFor(uid: string, force = false) {
  if (store.uid === uid && !force) return;
  setStore({ uid, ready: false, sync: 'loading' });
  let local: Partial<Prefs> = {};
  try {
    const raw = await AsyncStorage.getItem(localKey(uid));
    if (raw) local = sanitize(JSON.parse(raw));
  } catch {
    // start from defaults
  }
  let prefs: Prefs = { ...DEFAULT_PREFS, ...local };
  setStore({ prefs, ready: true });

  // The server copy wins, so settings follow the user to a new phone
  const res = await getPrivacySettings();
  if (store.uid !== uid) return; // user changed while loading
  if (res.ok) {
    const server = sanitize(res.data.settings);
    prefs = { ...prefs, ...server };
    setStore({ prefs, sync: 'synced' });
    persistLocal(uid, prefs);
    // Server has nothing yet but this phone has saved choices: send them up
    if (Object.keys(server).length === 0 && Object.keys(local).length > 0) updatePrivacySettings(local);
    enforceRetention(uid);
  } else {
    setStore({ sync: isMissingRpc(res.error) ? 'needs-setup' : 'local-only' });
  }
}

function update(patch: Partial<Prefs>) {
  const uid = store.uid;
  if (!uid) return;
  const prefs = { ...store.prefs, ...patch };
  setStore({ prefs });
  persistLocal(uid, prefs);
  updatePrivacySettings(patch).then((res) => {
    if (store.uid !== uid) return;
    if (res.ok) setStore({ sync: 'synced' });
    else setStore({ sync: isMissingRpc(res.error) ? 'needs-setup' : 'local-only' });
  });
}

// Sends every setting to the server again (used by the "Try again" button)
function syncNow() {
  const uid = store.uid;
  if (!uid) return;
  setStore({ sync: 'loading' });
  updatePrivacySettings({ ...store.prefs }).then((res) => {
    if (store.uid !== uid) return;
    setStore({ sync: res.ok ? 'synced' : isMissingRpc(res.error) ? 'needs-setup' : 'local-only' });
  });
}

export function usePrefs() {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (uid) loadFor(uid);
  }, [uid]);
  const reload = useCallback(() => {
    if (uid) loadFor(uid, true);
  }, [uid]);
  return { prefs: snap.prefs, ready: snap.ready, sync: snap.sync, update, reload, syncNow };
}
