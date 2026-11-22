import { useEffect, useSyncExternalStore } from 'react';

// Coordinates the once-per-launch brand intro with the Home screen, so Home reveals itself exactly when the
// intro starts to fade (or is skipped), never earlier and never after a fixed guess.
export const INTRO_HOLD_MS = 2300; // how long the intro stays before fading
export const INTRO_FADE_MS = 480;

let started = false;
let done = false;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const hasIntroPlayed = () => started;
export const markIntroStarted = () => {
  started = true;
};
export const finishIntro = () => {
  if (done) return;
  done = true;
  subs.forEach((f) => f());
};

// True once the intro is fading, was skipped, or has already played. A safety timer guarantees Home is never left hidden.
export function useIntroDone(): boolean {
  const isDone = useSyncExternalStore(subscribe, () => done, () => true);
  useEffect(() => {
    if (done) return;
    const t = setTimeout(finishIntro, INTRO_HOLD_MS + INTRO_FADE_MS + 600);
    return () => clearTimeout(t);
  }, []);
  return isDone;
}
