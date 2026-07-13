/**
 * Minimal CBOR (RFC 8949) encode/decode — just the subset WebAuthn needs:
 * unsigned/negative integers, byte strings, text strings, arrays and maps.
 * Enough to build/parse a `none` attestation object and an ES256 COSE key,
 * with no external dependency. Maps decode to `Map` so integer keys (used by
 * COSE) survive.
 */

function encodeHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n >>> 0, 1);
  return b;
}

export function encode(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([encodeHead(2, value.length), value]);
  }
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeHead(3, b.length), b]);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('cbor: only integers supported');
    return value >= 0 ? encodeHead(0, value) : encodeHead(1, -1 - value);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([encodeHead(4, value.length), ...value.map(encode)]);
  }
  if (value instanceof Map) {
    const parts = [encodeHead(5, value.size)];
    for (const [k, v] of value.entries()) parts.push(encode(k), encode(v));
    return Buffer.concat(parts);
  }
  throw new Error(`cbor: unsupported value ${typeof value}`);
}

export function decodeFirst(buf: Buffer): unknown {
  return decode(buf, 0)[0];
}

function decode(buf: Buffer, offset: number): [unknown, number] {
  const first = buf[offset];
  const major = first >> 5;
  const info = first & 0x1f;
  let n = info;
  let off = offset + 1;
  if (info === 24) {
    n = buf[off];
    off += 1;
  } else if (info === 25) {
    n = buf.readUInt16BE(off);
    off += 2;
  } else if (info === 26) {
    n = buf.readUInt32BE(off);
    off += 4;
  } else if (info > 26) {
    throw new Error('cbor: unsupported length encoding');
  }

  switch (major) {
    case 0:
      return [n, off];
    case 1:
      return [-1 - n, off];
    case 2:
      return [buf.subarray(off, off + n), off + n];
    case 3:
      return [buf.subarray(off, off + n).toString('utf8'), off + n];
    case 4: {
      const arr: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const [v, next] = decode(buf, off);
        arr.push(v);
        off = next;
      }
      return [arr, off];
    }
    case 5: {
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < n; i++) {
        const [k, afterKey] = decode(buf, off);
        const [v, afterVal] = decode(buf, afterKey);
        map.set(k, v);
        off = afterVal;
      }
      return [map, off];
    }
    default:
      throw new Error(`cbor: unsupported major type ${major}`);
  }
}
