import type { IconName } from '../components/ui/Icon';
import type { JourneyStatus } from './types';

export function fmtDuration(totalSeconds?: number | null): string {
  if (totalSeconds == null || !isFinite(totalSeconds)) return '–';
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function placeIcon(category?: string | null): IconName {
  switch (category) {
    case 'home': return 'home';
    case 'office': return 'office';
    case 'college': return 'school';
    case 'gym': return 'gym';
    default: return 'pin';
  }
}

export function statusMeta(status: JourneyStatus): { label: string; tone: 'green' | 'orange' | 'blue' } {
  if (status === 'arrived') return { label: 'Safe arrival', tone: 'green' };
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'orange' };
  return { label: 'In transit', tone: 'blue' };
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
