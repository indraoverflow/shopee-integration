import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePushEvent, pushSignature, verifyPushSignature } from "../src/webhook.js";

const KEY = "partner-key";
const URL_ = "https://example.test/webhook/shopee";
const BODY = '{"code":3,"shop_id":11,"timestamp":1762916645,"data":{"ordersn":"241112ABC"}}';

describe("pushSignature", () => {
  it("is HMAC-SHA256 over url followed by the raw body", () => {
    const expected = createHmac("sha256", KEY).update(URL_ + BODY).digest("hex");
    expect(pushSignature(KEY, URL_, BODY)).toBe(expected);
  });

  it("changes when the body changes by a single byte", () => {
    expect(pushSignature(KEY, URL_, BODY + " ")).not.toBe(pushSignature(KEY, URL_, BODY));
  });
});

describe("verifyPushSignature", () => {
  it("accepts the correct signature, including uppercase hex", () => {
    const signature = pushSignature(KEY, URL_, BODY);
    expect(verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY, signature })).toBe(true);
    expect(verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY, signature: signature.toUpperCase() })).toBe(true);
  });

  it("rejects a wrong key, a wrong url, a tampered body and an empty header", () => {
    const signature = pushSignature(KEY, URL_, BODY);
    expect(verifyPushSignature({ partnerKey: "other", url: URL_, rawBody: BODY, signature })).toBe(false);
    expect(verifyPushSignature({ partnerKey: KEY, url: URL_ + "/x", rawBody: BODY, signature })).toBe(false);
    expect(verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY.replace("241112ABC", "241112ABD"), signature })).toBe(false);
    expect(verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY, signature: "" })).toBe(false);
  });

  it("accepts a signature made with an alternate key, for console test pushes", () => {
    const testKey = "console-test-push-key";
    const signature = pushSignature(testKey, URL_, BODY);

    expect(verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY, signature })).toBe(false);
    expect(
      verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY, signature, alternateKeys: [testKey] }),
    ).toBe(true);
    expect(
      verifyPushSignature({ partnerKey: KEY, url: URL_, rawBody: BODY, signature, alternateKeys: [""] }),
    ).toBe(false);
  });
});

describe("parsePushEvent", () => {
  it("reads the push code and keeps the payload untouched", () => {
    const event = parsePushEvent(BODY);
    expect(event.code).toBe(3);
    expect(event.shop_id).toBe(11);
  });

  it("rejects a payload without a numeric code", () => {
    expect(() => parsePushEvent('{"shop_id":11}')).toThrow(/numeric code/);
  });
});
