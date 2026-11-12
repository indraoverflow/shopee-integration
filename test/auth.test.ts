import { describe, expect, it } from "vitest";
import { AUTH_PATH, TOKEN_PATH, authorizationUrl, exchangeCode, refreshAccessToken } from "../src/auth.js";
import type { ShopeeClient } from "../src/client.js";
import { sign } from "../src/signature.js";

const NOW = new Date("2026-11-12T03:04:05Z"); // unix 1762916645
const TS = Math.floor(NOW.getTime() / 1000);

describe("authorizationUrl", () => {
  it("is a public, signed URL carrying partner_id, timestamp, sign and redirect", () => {
    const url = new URL(
      authorizationUrl({
        partnerId: 2001887,
        partnerKey: "key",
        redirectUrl: "https://example.test/auth/callback",
        baseUrl: "https://partner.test-stable.shopeemobile.com",
        now: NOW,
      }),
    );

    expect(url.origin).toBe("https://partner.test-stable.shopeemobile.com");
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

describe("token exchange", () => {
  it("posts code, shop_id and partner_id to the token path", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fake = {
      publicPostFlat: async (path: string, body: Record<string, unknown>) => {
        calls.push({ path, body });
        // The real endpoint answers flat, with an empty error and no response wrapper.
        return { access_token: "a", refresh_token: "r", expire_in: 14400, error: "", message: "" };
      },
    } as unknown as ShopeeClient;

    const token = await exchangeCode(fake, 2001887, { code: "code-1", shopId: 11 });
    expect(token.access_token).toBe("a");
    expect(calls[0]).toEqual({ path: TOKEN_PATH, body: { code: "code-1", shop_id: 11, partner_id: 2001887 } });
  });

  it("refreshes through the public access_token path with the single-use refresh token", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fake = {
      publicPostFlat: async (path: string, body: Record<string, unknown>) => {
        calls.push({ path, body });
        return { access_token: "a2", refresh_token: "r2", expire_in: 14400 };
      },
    } as unknown as ShopeeClient;

    const token = await refreshAccessToken(fake, 2001887, { refreshToken: "r1", shopId: 11 });
    expect(token.refresh_token).toBe("r2");
    expect(calls[0]!.path).toBe("/api/v2/auth/access_token/get");
    expect(calls[0]).toEqual({ path: "/api/v2/auth/access_token/get", body: { refresh_token: "r1", shop_id: 11, partner_id: 2001887 } });
  });
});
