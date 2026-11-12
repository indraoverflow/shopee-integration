import { describe, expect, it } from "vitest";
import { AUTH_PATH, authorizationUrl } from "../src/auth.js";
import { sign } from "../src/signature.js";

const NOW = new Date("2026-11-12T03:04:05Z");
const TS = Math.floor(NOW.getTime() / 1000);

describe("authorizationUrl", () => {
  it("is a public, signed URL carrying partner_id, timestamp, sign and redirect", () => {
    const url = new URL(
      authorizationUrl({
        partnerId: 2001887,
        partnerKey: "key",
        redirectUrl: "https://example.test/auth/callback",
        baseUrl: "https://openplatform.sandbox.test-stable.shopee.sg",
        now: NOW,
      }),
    );

    expect(url.origin).toBe("https://openplatform.sandbox.test-stable.shopee.sg");
    expect(url.pathname).toBe(AUTH_PATH);
    expect(url.searchParams.get("partner_id")).toBe("2001887");
    expect(url.searchParams.get("timestamp")).toBe(String(TS));
    expect(url.searchParams.get("redirect")).toBe("https://example.test/auth/callback");
    expect(url.searchParams.get("sign")).toBe(
      sign({ partnerId: 2001887, partnerKey: "key", path: AUTH_PATH, timestamp: TS, kind: "public" }),
    );
  });

  it("produces a different signature for a different timestamp", () => {
    const a = authorizationUrl({ partnerId: 1, partnerKey: "k", redirectUrl: "https://x.test/cb", baseUrl: "https://h.test", now: NOW });
    const b = authorizationUrl({ partnerId: 1, partnerKey: "k", redirectUrl: "https://x.test/cb", baseUrl: "https://h.test", now: new Date(NOW.getTime() + 1000) });
    expect(new URL(a).searchParams.get("sign")).not.toBe(new URL(b).searchParams.get("sign"));
  });
});
