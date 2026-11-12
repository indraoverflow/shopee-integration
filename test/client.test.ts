import { describe, expect, it } from "vitest";
import { ShopeeApiError, ShopeeClient } from "../src/client.js";
import { sign } from "../src/signature.js";

const NOW = new Date("2026-11-12T03:04:05Z"); // unix 1762916645
const TS = Math.floor(NOW.getTime() / 1000);

function recordingFetch(payload: unknown, status = 200) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: URL | RequestInfo) => {
    calls.push(new URL(String(input)));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("ShopeeClient", () => {
  it("signs a public call with partner_id, path and timestamp only", async () => {
    const { calls, fetchImpl } = recordingFetch({ error: "", response: { ok: true } });
    const client = new ShopeeClient({ partnerId: 7, partnerKey: "key", baseUrl: "https://sandbox.test", fetchImpl, now: () => NOW });

    await client.publicGet("/api/v2/shop/get_shop_info");

    const url = calls[0]!;
    expect(url.origin).toBe("https://sandbox.test");
    expect(url.pathname).toBe("/api/v2/shop/get_shop_info");
    expect(url.searchParams.get("partner_id")).toBe("7");
    expect(url.searchParams.get("timestamp")).toBe(String(TS));
    expect(url.searchParams.get("access_token")).toBeNull();
    expect(url.searchParams.get("sign")).toBe(
      sign({ partnerId: 7, partnerKey: "key", path: "/api/v2/shop/get_shop_info", timestamp: TS, kind: "public" }),
    );
  });

  it("adds the access token and shop id to a shop call, and keeps extra query out of the signature", async () => {
    const { calls, fetchImpl } = recordingFetch({ error: "", response: { item: [] } });
    const client = new ShopeeClient({ partnerId: 7, partnerKey: "key", baseUrl: "https://sandbox.test", fetchImpl, now: () => NOW });

    await client.shopGet("/api/v2/product/get_item_list", { accessToken: "tok", shopId: 11 }, { page_size: 50, offset: 0 });

    const url = calls[0]!;
    expect(url.searchParams.get("access_token")).toBe("tok");
    expect(url.searchParams.get("shop_id")).toBe("11");
    expect(url.searchParams.get("page_size")).toBe("50");
    expect(url.searchParams.get("sign")).toBe(
      sign({
        partnerId: 7,
        partnerKey: "key",
        path: "/api/v2/product/get_item_list",
        timestamp: TS,
        kind: "shop",
        accessToken: "tok",
        shopId: 11,
      }),
    );
  });

  it("posts JSON to public endpoints such as the token exchange", async () => {
    const { fetchImpl } = recordingFetch({ error: "", response: { access_token: "a", refresh_token: "r", expire_in: 14400 } });
    const client = new ShopeeClient({ partnerId: 7, partnerKey: "key", baseUrl: "https://sandbox.test", fetchImpl, now: () => NOW });

    const token = await client.publicPost<{ access_token: string }>("/api/v2/auth/token/get", { code: "c", shop_id: 11 });
    expect(token.access_token).toBe("a");
  });

  it("throws ShopeeApiError when the envelope carries an error", async () => {
    const { fetchImpl } = recordingFetch({ error: "error_auth", message: "Invalid access_token.", request_id: "req-1" });
    const client = new ShopeeClient({ partnerId: 7, partnerKey: "key", baseUrl: "https://sandbox.test", fetchImpl, now: () => NOW });

    await expect(client.publicGet("/api/v2/shop/get_shop_info")).rejects.toBeInstanceOf(ShopeeApiError);
    await expect(client.publicGet("/api/v2/shop/get_shop_info")).rejects.toThrow(/error_auth/);
  });
});
