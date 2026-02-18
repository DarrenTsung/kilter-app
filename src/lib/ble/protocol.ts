/**
 * Pure BLE protocol encoding for Kilter Board.
 * Ported from climbdex bluetooth.js — no side effects, no I/O.
 */

const MAX_BLE_CHUNK_SIZE = 20;
const MESSAGE_BODY_MAX_LENGTH = 255;

// V3 packet markers (ASCII: Q, R, S, T)
const V3_MIDDLE = 81;
const V3_FIRST = 82;
const V3_LAST = 83;
const V3_ONLY = 84;

// V2 packet markers (ASCII: M, N, O, P)
const V2_MIDDLE = 77;
const V2_FIRST = 78;
const V2_LAST = 79;
const V2_ONLY = 80;

export interface LED {
  position: number;
  color: string; // hex "RRGGBB"
}

/** 8-bit checksum: bitwise NOT of running sum */
export function checksum(data: number[]): number {
  let sum = 0;
  for (const byte of data) {
    sum = (sum + byte) & 0xff;
  }
  return ~sum & 0xff;
}

/** Frame a message body with header (start, length, checksum) and trailer */
export function wrapBytes(data: number[]): number[] {
  if (data.length > MESSAGE_BODY_MAX_LENGTH) return [];
  return [0x01, data.length, checksum(data), 0x02, ...data, 0x03];
}

/** V3: encode position + color into 3 bytes */
export function encodeV3(position: number, color: string): number[] {
  const posLow = position & 0xff;
  const posHigh = (position >> 8) & 0xff;

  const r = Math.floor(parseInt(color.substring(0, 2), 16) / 32);
  const g = Math.floor(parseInt(color.substring(2, 4), 16) / 32);
  const b = Math.floor(parseInt(color.substring(4, 6), 16) / 64);
  const colorByte = (r << 5) | (g << 2) | b;

  return [posLow, posHigh, colorByte];
}

/** V2: encode position + scaled color into 2 bytes */
export function encodeV2(
  position: number,
  color: string,
  scale = 1.0
): number[] {
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);

  const rScaled = Math.floor((scale * r) / 64);
  const gScaled = Math.floor((scale * g) / 64);
  const bScaled = Math.floor((scale * b) / 64);

  const posLow = position & 0xff;
  const posHigh = (position & 0x300) >> 8;
  const colorByte = (rScaled << 6) | (gScaled << 4) | (bScaled << 2) | posHigh;

  return [posLow, colorByte];
}

/**
 * Build a complete BLE packet from LED data.
 * Groups holds into ≤255-byte bodies, assigns packet markers, wraps each.
 */
export function buildPacket(leds: LED[], apiLevel: number): Uint8Array {
  const isV3 = apiLevel >= 3;
  const bytesPerLed = isV3 ? 3 : 2;
  const middle = isV3 ? V3_MIDDLE : V2_MIDDLE;
  const first = isV3 ? V3_FIRST : V2_FIRST;
  const last = isV3 ? V3_LAST : V2_LAST;
  const only = isV3 ? V3_ONLY : V2_ONLY;

  const packets: number[][] = [];
  let current: number[] = [middle];

  for (const led of leds) {
    if (!isV3 && led.position > 1023) continue; // V2 can only address 10-bit positions

    const encoded = isV3
      ? encodeV3(led.position, led.color)
      : encodeV2(led.position, led.color);

    if (current.length + bytesPerLed > MESSAGE_BODY_MAX_LENGTH) {
      packets.push(current);
      current = [middle];
    }
    current.push(...encoded);
  }
  packets.push(current);

  // Set packet type markers
  if (packets.length === 1) {
    packets[0][0] = only;
  } else if (packets.length > 1) {
    packets[0][0] = first;
    packets[packets.length - 1][0] = last;
  }

  // Wrap and concatenate
  const result: number[] = [];
  for (const packet of packets) {
    result.push(...wrapBytes(packet));
  }

  return Uint8Array.from(result);
}

/** Split a packet into 20-byte BLE MTU chunks */
export function splitIntoChunks(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += MAX_BLE_CHUNK_SIZE) {
    chunks.push(data.slice(i, i + MAX_BLE_CHUNK_SIZE));
  }
  return chunks;
}
