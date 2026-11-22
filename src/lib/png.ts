import type { QrMatrix } from './qr';

// Minimal PNG writer (8-bit grayscale, uncompressed) so a QR code can be saved or shared as an image
// without any image library.

let CRC_TABLE: number[] | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE.push(c >>> 0);
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): number[] {
  const t = Array.from(type, (c) => c.charCodeAt(0));
  const body = new Uint8Array(t.length + data.length);
  body.set(t, 0);
  body.set(data, t.length);
  return [...u32(data.length), ...Array.from(body), ...u32(crc32(body))];
}

// dark modules are drawn in near-black on white, with a quiet zone of `border` modules
export function qrToPng(matrix: QrMatrix, scale = 12, border = 4): Uint8Array {
  const n = matrix.length;
  const px = (n + border * 2) * scale;
  const raw = new Uint8Array(px * (px + 1)); // each row starts with filter byte 0
  for (let y = 0; y < px; y++) {
    const my = Math.floor(y / scale) - border;
    const rowStart = y * (px + 1);
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - border;
      const dark = my >= 0 && my < n && mx >= 0 && mx < n && matrix[my][mx];
      raw[rowStart + 1 + x] = dark ? 0x08 : 0xff;
    }
  }
  // zlib stream made of "stored" (uncompressed) blocks
  const z: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(i + 65535, raw.length));
    const last = i + 65535 >= raw.length ? 1 : 0;
    z.push(last, part.length & 255, part.length >>> 8, ~part.length & 255, (~part.length >>> 8) & 255);
    for (let k = 0; k < part.length; k++) z.push(part[k]);
  }
  z.push(...u32(adler32(raw)));

  const ihdr = new Uint8Array([...u32(px), ...u32(px), 8, 0, 0, 0, 0]); // 8-bit grayscale
  const out = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', new Uint8Array(z)), ...chunk('IEND', new Uint8Array(0))];
  return new Uint8Array(out);
}
