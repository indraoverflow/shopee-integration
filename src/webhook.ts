import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Push signature from the Shopee Push Mechanism: HMAC-SHA256 over the full
 * callback URL concatenated with the raw request body, keyed by the partner
 * key, hex encoded. It is delivered in the Authorization header.
 *
 * The URL must be the exact public URL Shopee posts to, including the scheme,
 * host and path, and the body must be the bytes received, not a re-serialised
 * JSON object.
 */
export function pushSignature(partnerKey: string, url: string, rawBody: string): string {
  return createHmac("sha256", partnerKey).update(url + rawBody).digest("hex");
}

export interface VerifyPushInput {
  partnerKey: string;
  url: string;
  rawBody: string;
  /** Value of the Authorization header. */
  signature: string;
}

export function verifyPushSignature(input: VerifyPushInput): boolean {
  const expected = pushSignature(input.partnerKey, input.url, input.rawBody);
  const received = input.signature.trim().toLowerCase();
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
  } catch {
    return false;
  }
}

export interface PushEvent {
  /** Push code, e.g. 3 for order status update. */
  code: number;
  shop_id?: number;
  timestamp?: number;
  data?: unknown;
}

export function parsePushEvent(rawBody: string): PushEvent {
  const parsed = JSON.parse(rawBody) as Partial<PushEvent>;
  if (typeof parsed.code !== "number") {
    throw new Error("push payload has no numeric code");
  }
  return parsed as PushEvent;
}
