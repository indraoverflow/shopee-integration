import { describe, expect, it } from "vitest";
import { ShopeeApiError, type ShopeeClient } from "../src/client.js";
import type { Config } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { pushSignature } from "../src/webhook.js";

const config: Config = {
  partnerId: 2001887,
  partnerKey: "partner-key",
  env: "sandbox",
  baseUrl: "https://partner.test-stable.shopeemobile.com",
  redirectUrl: "https://example.test/auth/callback",
  publicUrl: "https://example.test/webhook/shopee",
  port: 3000,
};

function server(overrides: Partial<Config> = {}, client?: ShopeeClient) {
  return buildServer({ config: { ...config, ...overrides }, ...(client ? { client } : {}) });
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
    expect(url).toContain("partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner");
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
    // which is exactly how the real message got lost behind the tunnel.
    const fake = {
      publicPostFlat: async () => {
        throw new ShopeeApiError("invalid_code", "The code is expired or used or invalid");
      },
    } as unknown as ShopeeClient;
    const { app } = server({}, fake);

    const response = await app.inject({ method: "GET", url: "/auth/callback?code=stale&shop_id=11" });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("invalid_code");
  });

  it("stores the token and does not echo it", async () => {
    const fake = {
      publicPostFlat: async () => ({ access_token: "secret-access", refresh_token: "secret-refresh", expire_in: 14400 }),
    } as unknown as ShopeeClient;
    const { app, tokens } = server({}, fake);

    const response = await app.inject({ method: "GET", url: "/auth/callback?code=abc&shop_id=11" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ shop_id: 11, expires_in: 14400 });
    expect(response.body).not.toContain("secret-access");
    const stored = await tokens.get(11);
    expect(stored?.accessToken).toBe("secret-access");
  });
});

describe("GET /shop/info guard", () => {
  const fake = () =>
    ({ shopGet: async () => ({ shop_id: 11, shop_name: "Sandbox Shop", region: "ID", status: "NORMAL" }) }) as unknown as ShopeeClient;

  it("refuses a request without the shared secret once one is configured", async () => {
    const { app, tokens } = server({ shopInfoToken: "0123456789abcdef" }, fake());
    await tokens.set({ shopId: 11, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 });

    const anonymous = await app.inject({ method: "GET", url: "/shop/info?shop_id=11" });
    expect(anonymous.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "GET",
      url: "/shop/info?shop_id=11",
      headers: { "x-shop-info-token": "ffffffffffffffff" },
    });
    expect(wrong.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/shop/info?shop_id=11",
      headers: { "x-shop-info-token": "0123456789abcdef" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ shop_name: "Sandbox Shop" });
  });

  it("stays open when no secret is configured", async () => {
    const { app, tokens } = server({}, fake());
    await tokens.set({ shopId: 11, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 });

    const response = await app.inject({ method: "GET", url: "/shop/info?shop_id=11" });
    expect(response.statusCode).toBe(200);
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
        authorization: pushSignature(config.partnerKey, config.publicUrl!, body),
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
