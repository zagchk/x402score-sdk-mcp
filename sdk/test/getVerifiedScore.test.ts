import { describe, expect, it, vi } from "vitest";
import { X402ScoreClient } from "../src/client";
import * as verifyModule from "../src/verify";

function routedFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, res] of Object.entries(routes)) {
      if (url.endsWith(path)) return new Response(JSON.stringify(res.body), { status: res.status });
    }
    throw new Error(`No mock route for ${url}`);
  }) as unknown as typeof fetch;
}

const BASE_SCORE = {
  endpointId: "abc",
  score: 90,
  grade: "A",
  sampleSize: 50,
  confidence: 0.9,
  scoreInterval: { low: 85, high: 95, level: 0.9 },
  riskFlags: [],
  lastUpdated: "2026-09-25T00:00:00.000Z",
};

describe("getVerifiedScore", () => {
  it("returns null when the endpoint isn't scored yet", async () => {
    const client = new X402ScoreClient({ fetch: routedFetch({ "/score/abc": { status: 404, body: {} } }) });
    expect(await client.getVerifiedScore("abc")).toBeNull();
  });

  it("reports 'unsigned' when the score has no signature", async () => {
    const client = new X402ScoreClient({
      fetch: routedFetch({ "/score/abc": { status: 200, body: { ...BASE_SCORE, signature: null, signedAt: null, detailHash: null } } }),
    });
    const result = await client.getVerifiedScore("abc");
    expect(result).toEqual({
      score: { ...BASE_SCORE, signature: null, signedAt: null, detailHash: null },
      verified: false,
      reason: "unsigned",
    });
  });

  it("reports 'no_matching_key' when no signing key covers the score's signedAt", async () => {
    const signed = { ...BASE_SCORE, signature: "0xdead", signedAt: "2026-09-25T00:00:00.000Z", detailHash: "0xbeef" };
    const client = new X402ScoreClient({
      fetch: routedFetch({
        "/score/abc": { status: 200, body: signed },
        "/.well-known/x402": {
          status: 200,
          body: { signingKeys: [{ address: "0xkey1", validFrom: "2026-09-26T00:00:00.000Z", validUntil: null, label: null }] },
        },
      }),
    });
    const result = await client.getVerifiedScore("abc");
    expect(result).toEqual({ score: signed, verified: false, reason: "no_matching_key" });
  });

  it("picks the key valid at signedAt (not just the first key) when a rotation has happened", async () => {
    const signed = { ...BASE_SCORE, signature: "0xdead", signedAt: "2026-09-10T00:00:00.000Z", detailHash: "0xbeef" };
    const fetchImpl = routedFetch({
      "/score/abc": { status: 200, body: signed },
      "/.well-known/x402": {
        status: 200,
        body: {
          signingKeys: [
            { address: "0xold", validFrom: "2026-08-01T00:00:00.000Z", validUntil: "2026-09-01T00:00:00.000Z", label: "retired" },
            { address: "0xcurrent", validFrom: "2026-09-01T00:00:00.000Z", validUntil: null, label: "current" },
          ],
        },
      },
    });
    const spy = vi.spyOn(verifyModule, "verifyScoreResponse").mockReturnValue(true);
    const client = new X402ScoreClient({ fetch: fetchImpl });
    const result = await client.getVerifiedScore("abc");
    expect(spy).toHaveBeenCalledWith(signed, "0xcurrent");
    expect(result?.verified).toBe(true);
    spy.mockRestore();
  });

  it("reports 'signature_invalid' when a matching key is found but verification fails", async () => {
    const signed = { ...BASE_SCORE, signature: "0xdead", signedAt: "2026-09-25T00:00:00.000Z", detailHash: "0xbeef" };
    const client = new X402ScoreClient({
      fetch: routedFetch({
        "/score/abc": { status: 200, body: signed },
        "/.well-known/x402": {
          status: 200,
          body: { signingKeys: [{ address: "0xkey1", validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, label: null }] },
        },
      }),
    });
    const spy = vi.spyOn(verifyModule, "verifyScoreResponse").mockReturnValue(false);
    const result = await client.getVerifiedScore("abc");
    expect(result).toEqual({ score: signed, verified: false, reason: "signature_invalid" });
    spy.mockRestore();
  });
});
