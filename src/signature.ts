import { createHmac } from "node:crypto";

/**
 * The three kinds of Shopee Open Platform call. The kind decides which
 * parameters take part in the signature, nothing else does: extra query
 * parameters such as paging or filters never enter the base string.
 */
export type ApiKind = "public" | "shop" | "merchant";

export interface SignRequest {
  partnerId: number;
  partnerKey: string;
  /** API path with no host and no query string, e.g. /api/v2/shop/get_shop_info */
  path: string;
  /** Unix seconds. Shopee rejects a signature older than five minutes. */
  timestamp: number;
  kind: ApiKind;
  accessToken?: string;
  shopId?: number;
  merchantId?: number;
}

const API_PREFIX = "/api/v2";

export function assertApiPath(path: string): void {
  if (!path.startsWith(API_PREFIX)) {
    throw new Error(`path must start with ${API_PREFIX}: ${path}`);
  }
  if (path.includes("?")) {
    throw new Error(`path must not carry a query string: ${path}`);
  }
  if (path.includes("://")) {
    throw new Error(`path must not carry a host: ${path}`);
  }
}

/**
 * Concatenation order is fixed by Shopee and has no separators:
 * public   partner_id + path + timestamp
 * shop     partner_id + path + timestamp + access_token + shop_id
 * merchant partner_id + path + timestamp + access_token + merchant_id
 */
export function signBaseString(request: SignRequest): string {
  assertApiPath(request.path);

  if (request.kind === "public") {
    return `${request.partnerId}${request.path}${request.timestamp}`;
  }
  if (!request.accessToken) {
    throw new Error(`${request.kind} calls require an access token`);
  }
  if (request.kind === "shop") {
    if (request.shopId === undefined) {
      throw new Error("shop calls require a shop id");
    }
    return `${request.partnerId}${request.path}${request.timestamp}${request.accessToken}${request.shopId}`;
  }
  if (request.merchantId === undefined) {
    throw new Error("merchant calls require a merchant id");
  }
  return `${request.partnerId}${request.path}${request.timestamp}${request.accessToken}${request.merchantId}`;
}

/** Lowercase hex HMAC-SHA256 of the base string, keyed by the partner key. */
export function sign(request: SignRequest): string {
  return createHmac("sha256", request.partnerKey)
    .update(signBaseString(request))
    .digest("hex");
}

/** Unix seconds, truncated the way Shopee does. */
export function unixSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000);
}
