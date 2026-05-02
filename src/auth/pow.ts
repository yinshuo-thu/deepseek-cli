// DeepSeek-web Proof-of-Work solver.
//
// Algorithm: "DeepSeekHashV1" — SHA3-256 with the Keccak-f[1600] permutation
// reduced to rounds 1..23 (skipping round 0). Source-of-truth Go reference:
// github.com/CJackHwang/ds2api → pow/deepseek_hash.go and pow/deepseek_pow.go.
// Test vectors live in pow/deepseek_pow_test.go and are mirrored here in the
// scripts/smoke-pow.ts harness.
//
// Pure JS / TS, no native deps. Hot path uses Uint32Array pairs to dodge
// BigInt slowness; difficulty defaults to 144000 so worst-case ~150k hashes,
// well under a second.

/* eslint-disable no-bitwise */

// ---- Keccak-f[1600] reduced to rounds 1..23 ------------------------------

// Standard SHA-3 round constants. Each is a 64-bit value, stored as
// [hi, lo] uint32 pairs for the 32-bit-friendly impl below.
//
// The DeepSeek variant skips RC[0] = 0x0000000000000001 by starting at r=1.
const RC_HI: number[] = [
  0x00000000, 0x00000000, 0x80000000, 0x80000000,
  0x00000000, 0x00000000, 0x80000000, 0x80000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000,
  0x80000000, 0x80000000, 0x00000000, 0x80000000,
  0x80000000, 0x80000000, 0x00000000, 0x80000000,
];
// RC_LO/RC_HI hold the 24 standard Keccak-f[1600] iota round constants
// (indices 0..23). DeepSeekHashV1 skips RC[0] — only rounds 1..23 run —
// so RC_*[0] is intentionally never read at runtime; the slot remains for
// 1:1 alignment with the upstream Go implementation's constant tables.
const RC_LO: number[] = [
  0x00000001, 0x00008082, 0x0000808a, 0x80008000,
  0x0000808b, 0x80000001, 0x80008081, 0x00008009,
  0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
  0x8000808b, 0x0000008b, 0x00008089, 0x00008003,
  0x00008002, 0x00000080, 0x0000800a, 0x8000000a,
  0x80008081, 0x00008080, 0x80000001, 0x80008008,
];

// Rotation offsets for Rho/Pi step (lane indices and bit-rotations match
// the canonical Keccak spec). The mapping below mirrors `keccakF23` in
// ds2api's deepseek_hash.go lines 62-86.
//
// 64-bit rotate left by `n` (0..63), implemented on a [hi, lo] pair.
function rotl64(out: Uint32Array, hi: number, lo: number, n: number): void {
  n &= 63;
  if (n === 0) {
    out[0] = hi >>> 0;
    out[1] = lo >>> 0;
    return;
  }
  if (n < 32) {
    out[0] = ((hi << n) | (lo >>> (32 - n))) >>> 0;
    out[1] = ((lo << n) | (hi >>> (32 - n))) >>> 0;
  } else if (n === 32) {
    out[0] = lo >>> 0;
    out[1] = hi >>> 0;
  } else {
    const k = n - 32;
    out[0] = ((lo << k) | (hi >>> (32 - k))) >>> 0;
    out[1] = ((hi << k) | (lo >>> (32 - k))) >>> 0;
  }
}

// State is 25 lanes × 64 bits, encoded as Uint32Array(50): [hi0,lo0,hi1,lo1,...].
// We stash a few scratch buffers at module scope to avoid allocations in the
// solver hot loop.
const _rotScratch = new Uint32Array(2);
const _b = new Uint32Array(50);
const _c = new Uint32Array(10);
const _d = new Uint32Array(10);

function keccakF23(s: Uint32Array): void {
  for (let r = 1; r < 24; r++) {
    // theta
    for (let x = 0; x < 5; x++) {
      const i0 = x * 2;
      const i1 = (x + 5) * 2;
      const i2 = (x + 10) * 2;
      const i3 = (x + 15) * 2;
      const i4 = (x + 20) * 2;
      _c[i0] = (s[i0]! ^ s[i1]! ^ s[i2]! ^ s[i3]! ^ s[i4]!) >>> 0;
      _c[i0 + 1] = (s[i0 + 1]! ^ s[i1 + 1]! ^ s[i2 + 1]! ^ s[i3 + 1]! ^ s[i4 + 1]!) >>> 0;
    }
    for (let x = 0; x < 5; x++) {
      // d[x] = c[x-1] xor rotl(c[x+1], 1)
      const xm = ((x + 4) % 5) * 2;
      const xp = ((x + 1) % 5) * 2;
      rotl64(_rotScratch, _c[xp]!, _c[xp + 1]!, 1);
      _d[x * 2] = (_c[xm]! ^ _rotScratch[0]!) >>> 0;
      _d[x * 2 + 1] = (_c[xm + 1]! ^ _rotScratch[1]!) >>> 0;
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = (y + x) * 2;
        s[i] = (s[i]! ^ _d[x * 2]!) >>> 0;
        s[i + 1] = (s[i + 1]! ^ _d[x * 2 + 1]!) >>> 0;
      }
    }

    // rho + pi: build b[] from s[] using ds2api's hardcoded mapping
    //   (matches keccakF23 lines 62-86).
    // Source lane → (rotate, dest lane):
    //  0 →  (0,  0)     1 →  (1, 10)     2 →  (62, 20)    3 →  (28,  5)    4 →  (27, 15)
    //  5 →  (36, 16)    6 →  (44,  1)    7 →  (6, 11)     8 →  (55, 21)    9 →  (20,  6)
    // 10 →  (3,  7)    11 →  (10, 17)   12 →  (43,  2)   13 →  (25, 12)   14 →  (39, 22)
    // 15 →  (41, 23)   16 →  (45,  8)   17 →  (15, 18)   18 →  (21,  3)   19 →  (8, 13)
    // 20 →  (18, 14)   21 →  (2, 24)    22 →  (61,  9)   23 →  (56, 19)   24 →  (14,  4)
    const map: ReadonlyArray<[number, number]> = ROT_PI_MAP;
    for (let i = 0; i < 25; i++) {
      const [rot, dest] = map[i] as [number, number];
      const si = i * 2;
      rotl64(_rotScratch, s[si]!, s[si + 1]!, rot);
      const di = dest * 2;
      _b[di] = _rotScratch[0]!;
      _b[di + 1] = _rotScratch[1]!;
    }

    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const ix = (y + x) * 2;
        const ix1 = (y + ((x + 1) % 5)) * 2;
        const ix2 = (y + ((x + 2) % 5)) * 2;
        s[ix] = (_b[ix]! ^ ((~_b[ix1]! >>> 0) & _b[ix2]!)) >>> 0;
        s[ix + 1] = (_b[ix + 1]! ^ ((~_b[ix1 + 1]! >>> 0) & _b[ix2 + 1]!)) >>> 0;
      }
    }

    // iota: a0 ^= rc[r]
    s[0] = (s[0]! ^ RC_LO[r]!) >>> 0;
    s[1] = (s[1]! ^ RC_HI[r]!) >>> 0;
  }
}

const ROT_PI_MAP: ReadonlyArray<[number, number]> = [
  [0, 0], [1, 10], [62, 20], [28, 5], [27, 15],
  [36, 16], [44, 1], [6, 11], [55, 21], [20, 6],
  [3, 7], [10, 17], [43, 2], [25, 12], [39, 22],
  [41, 23], [45, 8], [15, 18], [21, 3], [8, 13],
  [18, 14], [2, 24], [61, 9], [56, 19], [14, 4],
];

const RATE = 136; // bytes; SHA3-256 rate

/**
 * DeepSeekHashV1 — 32-byte digest of `data`. Equivalent to SHA3-256 except
 * the Keccak-f[1600] permutation runs rounds 1..23 (skips round 0).
 */
export function deepSeekHashV1(data: Uint8Array): Uint8Array {
  const s = new Uint32Array(50);
  let off = 0;
  // Absorb full rate-sized blocks
  while (off + RATE <= data.length) {
    for (let i = 0; i < RATE / 8; i++) {
      const lo = readU32LE(data, off + i * 8);
      const hi = readU32LE(data, off + i * 8 + 4);
      s[i * 2] = (s[i * 2]! ^ lo) >>> 0;
      s[i * 2 + 1] = (s[i * 2 + 1]! ^ hi) >>> 0;
    }
    keccakF23(s);
    off += RATE;
  }

  // Final block + SHA3 padding
  const final = new Uint8Array(RATE);
  final.set(data.subarray(off));
  final[data.length - off] = 0x06;
  final[RATE - 1] = (final[RATE - 1]! | 0x80) >>> 0;
  for (let i = 0; i < RATE / 8; i++) {
    const lo = readU32LE(final, i * 8);
    const hi = readU32LE(final, i * 8 + 4);
    s[i * 2] = (s[i * 2]! ^ lo) >>> 0;
    s[i * 2 + 1] = (s[i * 2 + 1]! ^ hi) >>> 0;
  }
  keccakF23(s);

  // Squeeze 32 bytes (state words 0..3, little-endian)
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    writeU32LE(out, i * 8, s[i * 2]!);
    writeU32LE(out, i * 8 + 4, s[i * 2 + 1]!);
  }
  return out;
}

function readU32LE(buf: Uint8Array, off: number): number {
  return ((buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0);
}
function writeU32LE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

// ---- PoW challenge model + solver ----------------------------------------

export interface PowChallenge {
  algorithm: string;
  challenge: string; // 64-char hex
  salt: string;
  expire_at: number; // seconds since epoch (unix)
  difficulty: number;
  signature: string;
  target_path: string;
}

export class UnsupportedAlgorithmError extends Error {
  constructor(algo: string) {
    super(`pow: unsupported algorithm: ${algo}`);
    this.name = 'UnsupportedAlgorithmError';
  }
}

export class PowSolveError extends Error {
  constructor(message: string) {
    super(`pow: ${message}`);
    this.name = 'PowSolveError';
  }
}

/** `<salt>_<expire_at>_` — must match Go's `BuildPrefix` exactly. */
export function buildPrefix(salt: string, expireAt: number): string {
  return `${salt}_${expireAt}_`;
}

/**
 * Search nonce ∈ [0, difficulty) such that
 *   DeepSeekHashV1(prefix + str(nonce)) == challenge_hex
 * and return the nonce as a number. Throws PowSolveError if no nonce found.
 *
 * `signal` is checked periodically (every 1024 attempts) to allow watchdog
 * cancellation.
 */
export function solvePow(
  challengeHex: string,
  salt: string,
  expireAt: number,
  difficulty: number,
  signal?: AbortSignal,
): number {
  if (challengeHex.length !== 64) {
    throw new PowSolveError('challenge must be 64 hex chars');
  }
  const target = hexToBytes(challengeHex);
  const prefix = utf8(buildPrefix(salt, expireAt));
  const tail = new Uint8Array(20); // up to 20 decimal digits
  for (let n = 0; n < difficulty; n++) {
    if ((n & 0x3ff) === 0 && signal?.aborted) {
      throw new PowSolveError('aborted');
    }
    const nlen = writeDecimal(tail, n);
    const buf = new Uint8Array(prefix.length + nlen);
    buf.set(prefix, 0);
    buf.set(tail.subarray(0, nlen), prefix.length);
    const h = deepSeekHashV1(buf);
    if (bytesEqual(h, target)) return n;
  }
  throw new PowSolveError('no solution within difficulty');
}

/**
 * Solve and emit the `x-ds-pow-response` header value: base64(JSON({
 *   algorithm, challenge, salt, answer, signature, target_path
 * })). Difficulty defaults to 144000 if missing.
 */
export function solveAndBuildPowHeader(c: PowChallenge, signal?: AbortSignal): string {
  if (c.algorithm !== 'DeepSeekHashV1') {
    throw new UnsupportedAlgorithmError(c.algorithm);
  }
  const difficulty = c.difficulty > 0 ? c.difficulty : 144000;
  const answer = solvePow(c.challenge, c.salt, c.expire_at, difficulty, signal);
  return buildPowHeader(c, answer);
}

export function buildPowHeader(c: PowChallenge, answer: number): string {
  const payload = {
    algorithm: c.algorithm,
    challenge: c.challenge,
    salt: c.salt,
    answer,
    signature: c.signature,
    target_path: c.target_path,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

// ---- helpers --------------------------------------------------------------

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += b[i]!.toString(16).padStart(2, '0');
  }
  return s;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Writes decimal representation of `n` into the END of `buf`. Returns length. */
function writeDecimal(buf: Uint8Array, n: number): number {
  if (n === 0) {
    buf[0] = 0x30;
    return 1;
  }
  let pos = buf.length;
  let v = n;
  while (v > 0) {
    pos--;
    buf[pos] = 0x30 + (v % 10);
    v = Math.floor(v / 10);
  }
  const len = buf.length - pos;
  // Compact to start of buffer for caller convenience
  buf.copyWithin(0, pos, pos + len);
  return len;
}
