import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import type { ScoreResponse } from "./types.js";

// Mirrors src/scoring/signing.ts's digest construction exactly — see that
// file for the full design writeup (what a signature does and doesn't prove).
// Deliberately reimplemented here with @noble/curves + @noble/hashes rather
// than depending on viem (which the Worker uses) — viem is a much heavier
// dependency than this SDK should carry just to verify one signature.
const DOMAIN = "x402score-v1";

// @noble/curves' published types don't surface `recoverPublicKey` on the
// concrete `secp256k1` export (a rough edge in its own .d.ts, not a real type
// mismatch — verified working at runtime, cross-tested against a real
// viem-produced signature in test/verify.test.ts). One narrow, local cast
// rather than `any` everywhere it's used.
const curve = secp256k1 as unknown as { recoverPublicKey(signature: Uint8Array, message: Uint8Array): Uint8Array };

export interface SignedScorePayload {
  endpointId: string;
  score: number;
  /** Unix ms, e.g. `new Date(response.signedAt).getTime()`. */
  signedAt: number;
  detailHash: string;
  signature: string;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint256BigEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mirrors src/scoring/signing.ts's canonicalStringify exactly — recursively
 * sorts object keys so the same logical object always hashes the same way. */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

function computeDetailHash(detail: object): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(canonicalStringify(detail))));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function signingDigest(endpointId: string, score: number, signedAt: number, detailHash: string): Uint8Array {
  const packed = concatBytes(utf8Bytes(DOMAIN), utf8Bytes(endpointId), uint256BigEndian(BigInt(score)), uint256BigEndian(BigInt(signedAt)), hexToBytes(detailHash));
  return keccak_256(packed);
}

/** Ethereum-style address (last 20 bytes of keccak256 of the uncompressed
 * public key, minus its 0x04 prefix byte) — not checksummed; comparisons in
 * this module are case-insensitive, same as the Worker's own verifyScoreSignature.
 * `@noble/curves`' `recoverPublicKey` always returns a COMPRESSED (33-byte) key —
 * a real bug caught only by cross-testing against a signature the Worker's
 * viem-based signer actually produced: decompress via ProjectivePoint first, or
 * this silently derives the wrong address from a correctly-recovered key. */
function addressFromCompressedPubKey(compressedPubKey: Uint8Array): string {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(compressedPubKey).toRawBytes(false);
  const withoutPrefix = uncompressed.slice(1);
  const hash = keccak_256(withoutPrefix);
  return bytesToHex(hash.slice(-20));
}

/**
 * Verifies a score's signature against an expected signer address (get valid
 * addresses from `GET /.well-known/x402`'s `signingKeys`, checking the one
 * valid at `signedAt`). Returns `false` — never throws — for any malformed
 * input, so callers can treat "doesn't verify" uniformly.
 *
 * Note on what this proves: authenticity of origin and integrity of transit
 * — the data really was produced and signed by the holder of this key, and
 * hasn't been altered since. It does NOT prove the score itself is accurate;
 * a compromised signer could still sign false data with a legitimate key. See
 * x402Score's docs for the full explanation.
 */
export function verifyScoreSignature(payload: SignedScorePayload, expectedAddress: string): boolean {
  try {
    const digest = signingDigest(payload.endpointId, payload.score, payload.signedAt, payload.detailHash);
    const sigHex = payload.signature.startsWith("0x") ? payload.signature.slice(2) : payload.signature;
    if (sigHex.length !== 130) return false; // 32 (r) + 32 (s) + 1 (v) bytes, hex-encoded
    const r = BigInt("0x" + sigHex.slice(0, 64));
    const s = BigInt("0x" + sigHex.slice(64, 128));
    const v = parseInt(sigHex.slice(128, 130), 16);
    const recovery = v >= 27 ? v - 27 : v;
    const signature = new secp256k1.Signature(r, s, recovery);
    const pubKey = curve.recoverPublicKey(signature.toBytes("recovered"), digest);
    const recoveredAddress = addressFromCompressedPubKey(pubKey);
    return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The full check for a real `GET /score/:endpointId` response: recomputes
 * `detailHash` from the response's own public fields (grade, sampleSize,
 * confidence, scoreInterval) and confirms it matches what was signed, THEN
 * verifies the signature — not just the signature in isolation, which alone
 * wouldn't catch a response whose visible fields were altered after signing if
 * `detailHash` were forged to match. Returns `false` (never throws) if the
 * response is unsigned (`signature`/`signedAt`/`detailHash` all null — e.g. a
 * deployment without response signing configured).
 */
export function verifyScoreResponse(response: ScoreResponse, expectedAddress: string): boolean {
  if (!response.signature || !response.signedAt || !response.detailHash) return false;
  const detail = { grade: response.grade, sampleSize: response.sampleSize, confidence: response.confidence, scoreInterval: response.scoreInterval };
  if (computeDetailHash(detail) !== response.detailHash) return false;
  return verifyScoreSignature(
    {
      endpointId: response.endpointId,
      score: response.score,
      signedAt: new Date(response.signedAt).getTime(),
      detailHash: response.detailHash,
      signature: response.signature,
    },
    expectedAddress,
  );
}
