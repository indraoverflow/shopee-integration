import { ShopeeApiError, type ShopeeSDK } from "@congminh1254/shopee-sdk";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { toStoredToken } from "../src/tokens.js";
import { pushSignature } from "../src/webhook.js";

const config: Config = {
  partnerId: 2001887,
  partnerKey: "partner-key",
  env: "sandbox",
  baseUrl: "https://openplatform.sandbox.test-stable.shopee.sg",
  redirectUrl: "https://example.test/auth/callback",
  publicUrl: "https://example.test/webhook/shopee",
  port: 3000,
};

function server(overrides: Partial<Config> = {}, sdkFor?: (shopId: number) => ShopeeSDK) {
  return buildServer({ config: { ...config, ...overrides }, ...(sdkFor ? { sdkFor } : {}) });
}

describe("GET /health", () => {
  it("reports the configured environment", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, environment: "sandbox" });
  });
});

describe("GET /auth/url", () => {
  it("returns a signed authorization url and never the partner key", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/auth/url" });
    expect(response.statusCode).toBe(200);
    const { url } = response.json() as { url: string };
    expect(url).toContain("openplatform.sandbox.test-stable.shopee.sg/api/v2/shop/auth_partner");
    expect(url).toContain("partner_id=2001887");
    expect(url).not.toContain("partner-key");
  });
});

describe("GET /auth/callback", () => {
  it("rejects a callback without code or shop id", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/auth/callback" });
    expect(response.statusCode).toBe(400);
  });

  it("answers 400, not 502, when Shopee rejects the code", async () => {
    // A gateway status here would be replaced by the proxy's own error page,
    // which is how the real message was lost behind the tunnel.
    const sdkFor = () =>
      ({
        authenticateWithCode: async () => {
          throw new ShopeeApiError(400, { error: "invalid_code", message: "The code is expired or used or invalid" });
        },
      }) as unknown as ShopeeSDK;
    const { app } = server({}, sdkFor);

    const response = await app.inject({ method: "GET", url: "/auth/callback?code=stale&shop_id=11" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("invalid_code");
  });

  it("stores the token through the storage bridge and does not echo it", async () => {
    const { app, tokens } = server({}, (shopId) =>
      ({
        authenticateWithCode: async () => {
          const token = { access_token: "secret-access", refresh_token: "secret-refresh", expire_in: 14400 };
          await tokens.set(toStoredToken(shopId, token));
          return token;
        },
      }) as unknown as ShopeeSDK,
    );

    const response = await app.inject({ method: "GET", url: "/auth/callback?code=abc&shop_id=11" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ shop_id: 11, expires_in: 14400 });
    expect(response.body).not.toContain("secret-access");
    const stored = await tokens.get(11);
    expect(stored?.accessToken).toBe("secret-access");
  });
});

describe("GET /shop/info", () => {
  it("reports 404 when the shop has never been authorized", async () => {
    const { app } = server();
    const response = await app.inject({ method: "GET", url: "/shop/info?shop_id=11" });
    expect(response.statusCode).toBe(404);
  });

  it("returns the shop from the sdk and never the token", async () => {
    const { app, tokens } = server({}, () =>
      ({
        shop: { getShopInfo: async () => ({ shop_name: "Sandbox Shop", region: "ID", status: "NORMAL" }) },
      }) as unknown as ShopeeSDK,
    );
    await tokens.set({
      shopId: 11,
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      expiresAt: Date.now() + 3_600_000,
    });

    const response = await app.inject({ method: "GET", url: "/shop/info?shop_id=11" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.shop_name).toBe("Sandbox Shop");
    expect(response.body).not.toContain("secret-access");
  });
});

describe("POST /webhook/shopee", () => {
  const body = '{"code":3,"shop_id":11,"data":{"ordersn":"241112ABC"}}';

  it("accepts a correctly signed push", async () => {
    const { app } = server();
    const response = await app.inject({
      method: "POST",
      url: "/webhook/shopee",
      headers: {
        "content-type": "application/json",
        authorization: pushSignature("partner-key", config.publicUrl!, body),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, code: 3 });
  });

  it("rejects an unsigned or wrongly signed push", async () => {
    const { app } = server();
    const unsigned = await app.inject({ method: "POST", url: "/webhook/shopee", headers: { "content-type": "application/json" }, payload: body });
    expect(unsigned.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "POST",
      url: "/webhook/shopee",
      headers: { "content-type": "application/json", authorization: "0".repeat(64) },
      payload: body,
    });
    expect(wrong.statusCode).toBe(401);
  });
});
