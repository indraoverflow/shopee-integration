import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertApiPath, sign, signBaseString, unixSeconds } from "../src/signature.js";

/**
 * The base string below is Shopee's own worked example from the Open Platform
 * signature documentation. The partner key in that example is not published, so
 * the digest is checked against an independent HMAC of the same base string
 * rather than against a copied hex value.
 */
const VECTOR = {
  partnerId: 2001887,
  partnerKey: "partner-key-from-the-console",
  path: "/api/v2/shop/get_shop_info",
  timestamp: 1655714431,
  accessToken: "59777174636562737266615546704c6d",
  shopId: 14701711,
  baseString: "2001887/api/v2/shop/get_shop_info165571443159777174636562737266615546704c6d14701711",
};

const shopInput = {
  partnerId: VECTOR.partnerId,
  partnerKey: VECTOR.partnerKey,
  path: VECTOR.path,
  timestamp: VECTOR.timestamp,
  kind: "shop" as const,
  accessToken: VECTOR.accessToken,
  shopId: VECTOR.shopId,
};

describe("signBaseString", () => {
  it("concatenates shop parameters in the documented order", () => {
    expect(signBaseString(shopInput)).toBe(VECTOR.baseString);
  });

  it("stops after the timestamp for public calls", () => {
    expect(
      signBaseString({
        partnerId: 42,
        partnerKey: "k",
        path: "/api/v2/auth/token/get",
        timestamp: 1700000000,
        kind: "public",
      }),
    ).toBe("42/api/v2/auth/token/get1700000000");
  });

  it("uses merchant_id instead of shop_id for merchant calls", () => {
    expect(
      signBaseString({
        partnerId: 42,
        partnerKey: "k",
        path: "/api/v2/merchant/get_merchant_info",
        timestamp: 1700000000,
        kind: "merchant",
        accessToken: "tok",
        merchantId: 99,
      }),
    ).toBe("42/api/v2/merchant/get_merchant_info1700000000tok99");
  });

  it("refuses shop calls without an access token or shop id", () => {
    expect(() => signBaseString({ ...shopInput, accessToken: undefined })).toThrow(/access token/);
    expect(() => signBaseString({ ...shopInput, shopId: undefined })).toThrow(/shop id/);
  });
});

describe("sign", () => {
  it("is lowercase hex HMAC-SHA256 over the documented base string", () => {
    const expected = createHmac("sha256", VECTOR.partnerKey).update(VECTOR.baseString).digest("hex");
    const actual = sign(shopInput);
    expect(actual).toBe(expected);
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it("depends on the timestamp, so a cached signature is stale", () => {
    const later = sign({ ...shopInput, timestamp: VECTOR.timestamp + 1 });
    expect(later).not.toBe(sign(shopInput));
  });
});

describe("assertApiPath", () => {
  it("rejects a query string, a host and a path outside /api/v2", () => {
    expect(() => assertApiPath("/api/v2/shop/get_shop_info?x=1")).toThrow(/query string/);
    expect(() => assertApiPath("https://partner.shopeemobile.com/api/v2/x")).toThrow(/start with/);
    expect(() => assertApiPath("/v1/item/add")).toThrow(/start with/);
  });
});

describe("unixSeconds", () => {
  it("truncates to whole seconds", () => {
    const at = new Date("2026-11-12T00:00:00.789Z");
    expect(unixSeconds(at)).toBe(Math.floor(at.getTime() / 1000));
  });
});
