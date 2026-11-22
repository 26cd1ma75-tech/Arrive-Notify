import { useMemo } from 'react';
import { View } from 'react-native';
import { encodeQr } from '../../lib/qr';

// Draws a QR code from plain views (no SVG library needed). Whole-pixel cells keep the edges
// sharp so cameras read it easily. Returns a white square that includes the required quiet zone.
const QUIET = 4;

export function qrPixelSize(value: string, maxSize: number): number {
  const n = encodeQr(value).length;
  return Math.max(2, Math.floor(maxSize / (n + QUIET * 2))) * (n + QUIET * 2);
}

export default function QrCode({ value, maxSize, radius = 16 }: { value: string; maxSize: number; radius?: number }) {
  const { runs, cell, total } = useMemo(() => {
    const m = encodeQr(value);
    const n = m.length;
    const c = Math.max(2, Math.floor(maxSize / (n + QUIET * 2)));
    // merge neighbouring dark modules of a row into one bar
    const r: { x: number; y: number; len: number }[] = [];
    for (let y = 0; y < n; y++) {
      let x = 0;
      while (x < n) {
        if (!m[y][x]) {
          x++;
          continue;
        }
        let len = 1;
        while (x + len < n && m[y][x + len]) len++;
        r.push({ x, y, len });
        x += len;
      }
    }
    return { runs: r, cell: c, total: c * (n + QUIET * 2) };
  }, [value, maxSize]);

  return (
    <View
      style={{ width: total, height: total, backgroundColor: '#FFFFFF', borderRadius: radius, overflow: 'hidden' }}
      accessible
      accessibilityLabel="Your Arrive Notify QR code"
    >
      {runs.map((r) => (
        <View
          key={`${r.y}-${r.x}`}
          style={{ position: 'absolute', left: (r.x + QUIET) * cell, top: (r.y + QUIET) * cell, width: r.len * cell, height: cell, backgroundColor: '#0B1230' }}
        />
      ))}
    </View>
  );
}
