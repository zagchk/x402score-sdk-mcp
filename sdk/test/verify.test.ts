import { describe, expect, it } from "vitest";
import { verifyScoreResponse, verifyScoreSignature } from "../src/verify";
import type { ScoreResponse } from "../src/types";

// A real signature produced by the Worker's viem-based signer (src/scoring/signing.ts)
// against a real local endpoint during development, captured verbatim. This is a
// deliberate cross-implementation fixture, not a synthetic one — this SDK
// reimplements verification with @noble/curves + @noble/hashes rather than
// depending on viem, and a self-consistency test alone would have missed a real
// bug caught only by testing against a signature the OTHER implementation
// actually produced: @noble/curves' recoverPublicKey returns a compressed
// (33-byte) public key, not uncompressed — deriving an address straight from it
// silently produces the wrong address, passing every self-consistency test
// while failing to ever verify a real signature.
const REAL_FIXTURE = {
  payload: {
    endpointId: "dff24ca923585bbb",
    score: 63,
    signedAt: new Date("2026-09-18T12:54:48.632Z").getTime(),
    detailHash: "0x6bb062ed8fba486891203101b8b466d9e30829f13360c1f726bacdfab2bf5426",
    signature:
      "0x4c69cab8eaf829a42b6e247b6b32151ca409dd53863a2ed388e5c73bce1ff14b1b3db1364ceeda897a5189ac982314125a31581772bee0211c1711e9127e4d891b",
  },
  signerAddress: "0xD63BD1F848FAdBB9de98F86B626f165d0d44b528",
};

describe("verifyScoreSignature — real cross-implementation fixture", () => {
  it("verifies a real signature produced by the Worker's viem-based signer", () => {
    expect(verifyScoreSignature(REAL_FIXTURE.payload, REAL_FIXTURE.signerAddress)).toBe(true);
  });

  it("is case-insensitive when comparing the recovered address", () => {
    expect(verifyScoreSignature(REAL_FIXTURE.payload, REAL_FIXTURE.signerAddress.toLowerCase())).toBe(true);
    expect(verifyScoreSignature(REAL_FIXTURE.payload, REAL_FIXTURE.signerAddress.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects the correct signature against the wrong address", () => {
    expect(verifyScoreSignature(REAL_FIXTURE.payload, "0x0000000000000000000000000000000000000000")).toBe(false);
  });

  it("rejects if the score was tampered with", () => {
    expect(verifyScoreSignature({ ...REAL_FIXTURE.payload, score: 99 }, REAL_FIXTURE.signerAddress)).toBe(false);
  });

  it("rejects if the endpointId was tampered with", () => {
    expect(verifyScoreSignature({ ...REAL_FIXTURE.payload, endpointId: "different" }, REAL_FIXTURE.signerAddress)).toBe(false);
  });

  it("rejects if signedAt was tampered with", () => {
    expect(verifyScoreSignature({ ...REAL_FIXTURE.payload, signedAt: REAL_FIXTURE.payload.signedAt + 1 }, REAL_FIXTURE.signerAddress)).toBe(false);
  });

  it("rejects if detailHash was tampered with", () => {
    expect(
      verifyScoreSignature({ ...REAL_FIXTURE.payload, detailHash: "0x" + "ab".repeat(32) }, REAL_FIXTURE.signerAddress),
    ).toBe(false);
  });

  it("never throws on a malformed signature — returns false", () => {
    expect(verifyScoreSignature({ ...REAL_FIXTURE.payload, signature: "0xnotreal" }, REAL_FIXTURE.signerAddress)).toBe(false);
    expect(verifyScoreSignature({ ...REAL_FIXTURE.payload, signature: "" }, REAL_FIXTURE.signerAddress)).toBe(false);
  });
});

// The exact real GET /score/:endpointId response captured alongside the fixture above.
const REAL_RESPONSE: ScoreResponse = {
  endpointId: "dff24ca923585bbb",
  score: 63,
  grade: "C",
  sampleSize: 1,
  confidence: 0.16666666666666666,
  scoreInterval: { low: 40, high: 77, level: 0.9 },
  riskFlags: [],
  lastUpdated: "2026-09-18T12:54:48.632Z",
  signature: REAL_FIXTURE.payload.signature,
  signedAt: "2026-09-18T12:54:48.632Z",
  detailHash: REAL_FIXTURE.payload.detailHash,
};

describe("verifyScoreResponse", () => {
  it("verifies a real, complete score response", () => {
    expect(verifyScoreResponse(REAL_RESPONSE, REAL_FIXTURE.signerAddress)).toBe(true);
  });

  it("returns false for an unsigned response", () => {
    expect(verifyScoreResponse({ ...REAL_RESPONSE, signature: null, signedAt: null, detailHash: null }, REAL_FIXTURE.signerAddress)).toBe(false);
  });

  it("catches a forged detailHash paired with a genuinely valid signature for that (forged) hash — i.e. rejects if the visible fields don't match what the hash claims to cover", () => {
    // A tampered grade with the ORIGINAL detailHash/signature still left in place —
    // the recomputed hash from the (tampered) visible fields won't match.
    expect(verifyScoreResponse({ ...REAL_RESPONSE, grade: "A" }, REAL_FIXTURE.signerAddress)).toBe(false);
  });

  it("rejects a tampered score even though detailHash doesn't cover score directly", () => {
    expect(verifyScoreResponse({ ...REAL_RESPONSE, score: 100 }, REAL_FIXTURE.signerAddress)).toBe(false);
  });
});
