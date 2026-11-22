// Screen-size helpers so layouts and the logo adapt from phones to tablets and desktop browsers.
export type Device = 'phone' | 'tablet' | 'desktop';

export const deviceFor = (width: number): Device => (width >= 1024 ? 'desktop' : width >= 600 ? 'tablet' : 'phone');

// Content column stops growing on wide screens so screens stay readable
export const CONTENT_MAX = 720;

// Size of the big logo in the brand intro: about 36% of the shorter side, kept between 110 and 220
export function introLogoSize(width: number, height: number): number {
  const base = Math.min(width, height) * 0.36;
  return Math.round(Math.max(110, Math.min(base, 220)));
}
